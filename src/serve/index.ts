import { makeCancelRequest } from "../client/utils";
import {
  SDK_TELEMETRY,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_LABEL_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "../constants";
import { WorkflowContext } from "../context";
import {
  formatWorkflowError,
  isInstanceOf,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from "../error";
import { WorkflowLogger } from "../logger";
import { runMiddlewares } from "../middleware/middleware";
import {
  ExclusiveValidationOptions,
  RouteFunction,
  Telemetry,
  WorkflowServeOptions,
} from "../types";
import { getPayload, handleFailure, parseRequest, validateRequest } from "../workflow-parser";
import {
  handleThirdPartyCallResult,
  recreateUserHeaders,
  triggerFirstInvocation,
  triggerRouteFunction,
  triggerWorkflowDelete,
  verifyRequest,
} from "../workflow-requests";
import { DisabledWorkflowContext } from "./authorization";
import { AUTH_FAIL_MESSAGE, determineUrls, processOptions } from "./options";

/**
 * Creates an async method that handles incoming requests and runs the provided
 * route function as a workflow.
 *
 * Not exported in the package. Instead, used in framework specific serve implementations.
 *
 * Only difference from regular serve is the `useJSONContent` parameter.
 *
 * @param routeFunction - A function that uses WorkflowContext as a parameter and runs a workflow.
 * @param options - Options including the client, onFinish callback, and initialPayloadParser.
 * @returns An async method that consumes incoming requests and runs the workflow.
 */
export const serveBase = <
  TInitialPayload = unknown,
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TResult = unknown,
>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  telemetry?: Telemetry,
  options?: WorkflowServeOptions<TResponse, TInitialPayload>
): {
  handler: (request: TRequest) => Promise<TResponse>;
} => {
  // Prepares options with defaults if they are not provided.

  const {
    qstashClient,
    onStepFinish,
    initialPayloadParser,
    url,
    verbose,
    receiver,
    failureUrl,
    failureFunction,
    baseUrl,
    env,
    retries,
    retryDelay,
    useJSONContent,
    disableTelemetry,
    flowControl,
    onError,
    middlewares,
  } = processOptions<TResponse, TInitialPayload>(options);
  telemetry = disableTelemetry ? undefined : telemetry;
  const debug = WorkflowLogger.getLogger(verbose);

  /**
   * Handles the incoming request, triggering the appropriate workflow steps.
   * Calls `triggerFirstInvocation()` if it's the first invocation.
   * Otherwise, starts calling `triggerRouteFunction()` to execute steps in the workflow.
   * Finally, calls `triggerWorkflowDelete()` to remove the workflow from QStash.
   *
   * @param request - The incoming request to handle.
   * @returns A promise that resolves to a response.
   */
  const handler = async (request: TRequest) => {
    await debug?.log("INFO", "ENDPOINT_START");

    const { workflowUrl, workflowFailureUrl } = await determineUrls(
      request,
      url,
      baseUrl,
      failureFunction,
      failureUrl,
      debug
    );

    // get payload as raw string
    const requestPayload = (await getPayload(request)) ?? "";
    await verifyRequest(requestPayload, request.headers.get("upstash-signature"), receiver);

    // validation & parsing
    const { isFirstInvocation, workflowRunId } = validateRequest(request);
    debug?.setWorkflowRunId(workflowRunId);

    // parse steps
    const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest(
      requestPayload,
      isFirstInvocation,
      workflowRunId,
      qstashClient.http,
      request.headers.get("upstash-message-id")!,
      debug
    );

    if (workflowRunEnded) {
      return onStepFinish(workflowRunId, "workflow-already-ended", {
        condition: "workflow-already-ended",
      });
    }

    // terminate current call if it's a duplicate branch
    if (isLastDuplicate) {
      return onStepFinish(workflowRunId, "duplicate-step", {
        condition: "duplicate-step",
      });
    }

    // check if the request is a failure callback
    const failureCheck = await handleFailure<TInitialPayload>(
      request,
      requestPayload,
      qstashClient,
      initialPayloadParser,
      routeFunction,
      failureFunction,
      env,
      retries,
      retryDelay,
      flowControl,
      debug
    );
    if (failureCheck.isErr()) {
      // unexpected error during handleFailure
      throw failureCheck.error;
    } else if (failureCheck.value.result === "failure-function-executed") {
      // is a failure ballback.
      await debug?.log("WARN", "RESPONSE_DEFAULT", "failureFunction executed");
      return onStepFinish(workflowRunId, "failure-callback-executed", {
        condition: "failure-callback-executed",
        result: failureCheck.value.response,
      });
    } else if (failureCheck.value.result === "failure-function-undefined") {
      return onStepFinish(workflowRunId, "failure-callback-undefined", {
        condition: "failure-callback-undefined",
      });
    }

    const invokeCount = Number(request.headers.get(WORKFLOW_INVOKE_COUNT_HEADER) ?? "0");
    const label = request.headers.get(WORKFLOW_LABEL_HEADER) ?? undefined;

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: initialPayloadParser(rawInitialPayload),
      headers: recreateUserHeaders(request.headers as Headers),
      steps,
      url: workflowUrl,
      failureUrl: workflowFailureUrl,
      debug,
      env,
      retries,
      retryDelay,
      telemetry,
      invokeCount,
      flowControl,
      label,
      middlewares,
    });

    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(
      routeFunction,
      workflowContext
    );
    if (authCheck.isErr()) {
      // got error while running until first step
      await debug?.log("ERROR", "ERROR", { error: authCheck.error.message });
      throw authCheck.error;
    } else if (authCheck.value === "run-ended") {
      // finished routeFunction while trying to run until first step.
      // either there is no step or auth check resulted in `return`
      await debug?.log("ERROR", "ERROR", { error: AUTH_FAIL_MESSAGE });
      return onStepFinish(
        isFirstInvocation ? "no-workflow-id" : workflowContext.workflowRunId,
        "auth-fail",
        { condition: "auth-fail" }
      );
    }

    // check if request is a third party call result
    const callReturnCheck = await handleThirdPartyCallResult({
      request,
      requestPayload: rawInitialPayload,
      client: qstashClient,
      workflowUrl,
      failureUrl: workflowFailureUrl,
      retries,
      retryDelay,
      flowControl,
      telemetry,
      debug,
    });
    if (callReturnCheck.isErr()) {
      // error while checking
      await debug?.log("ERROR", "SUBMIT_THIRD_PARTY_RESULT", {
        error: callReturnCheck.error.message,
      });
      throw callReturnCheck.error;
    } else if (callReturnCheck.value === "continue-workflow") {
      // request is not third party call. Continue workflow as usual
      const result = isFirstInvocation
        ? await triggerFirstInvocation({
            workflowContext,
            useJSONContent,
            telemetry,
            debug,
            invokeCount,
          })
        : await triggerRouteFunction({
            onStep: async () => {
              if (steps.length === 1) {
                await runMiddlewares(middlewares, "runStarted", {
                  workflowRunId: workflowContext.workflowRunId,
                });
              }
              await routeFunction(workflowContext);
            },
            onCleanup: async (result) => {
              await runMiddlewares(middlewares, "runCompleted", {
                workflowRunId: workflowContext.workflowRunId,
                result,
              });
              await triggerWorkflowDelete(workflowContext, result, debug);
            },
            onCancel: async () => {
              await makeCancelRequest(workflowContext.qstashClient.http, workflowRunId);
            },
            debug,
          });

      if (result.isOk() && isInstanceOf(result.value, WorkflowNonRetryableError)) {
        return onStepFinish(workflowRunId, result.value, {
          condition: "non-retryable-error",
          result: result.value,
        });
      }

      if (result.isOk() && isInstanceOf(result.value, WorkflowRetryAfterError)) {
        return onStepFinish(workflowRunId, result.value, {
          condition: "retry-after-error",
          result: result.value,
        });
      }

      if (result.isErr()) {
        // error while running the workflow or when cleaning up
        await debug?.log("ERROR", "ERROR", { error: result.error.message });
        throw result.error;
      }

      // Returns a Response with `workflowRunId` at the end of each step.
      await debug?.log("INFO", "RESPONSE_WORKFLOW");
      return onStepFinish(workflowContext.workflowRunId, "success", {
        condition: "success",
      });
    } else if (callReturnCheck.value === "workflow-ended") {
      return onStepFinish(workflowContext.workflowRunId, "workflow-already-ended", {
        condition: "workflow-already-ended",
      });
    }
    // response to QStash in call cases
    await debug?.log("INFO", "RESPONSE_DEFAULT");
    return onStepFinish("no-workflow-id", "fromCallback", {
      condition: "fromCallback",
    });
  };

  const safeHandler = async (request: TRequest) => {
    try {
      return await handler(request);
    } catch (error) {
      const formattedError = formatWorkflowError(error);
      try {
        onError?.(error as Error);
      } catch (onErrorError) {
        const formattedOnErrorError = formatWorkflowError(onErrorError);
        const errorMessage =
          `Error while running onError callback: '${formattedOnErrorError.message}'.` +
          `\nOriginal error: '${formattedError.message}'`;

        console.error(errorMessage);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: {
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          },
        }) as TResponse;
      }
      return new Response(JSON.stringify(formattedError), {
        status: 500,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        },
      }) as TResponse;
    }
  };

  return { handler: safeHandler };
};

/**
 * Creates an async method that handles incoming requests and runs the provided
 * route function as a workflow.
 *
 * @param routeFunction - A function that uses WorkflowContext as a parameter and runs a workflow.
 * @param options - Options including the client, onFinish callback, and initialPayloadParser.
 * @returns An async method that consumes incoming requests and runs the workflow.
 */
export const serve = <
  TInitialPayload = unknown,
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TResult = unknown,
>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: Omit<
    WorkflowServeOptions<TResponse, TInitialPayload>,
    "useJSONContent" | "schema" | "initialPayloadParser"
  > &
    ExclusiveValidationOptions<TInitialPayload>
): ReturnType<typeof serveBase<TInitialPayload, TRequest, TResponse, TResult>> => {
  return serveBase(
    routeFunction,
    {
      sdk: SDK_TELEMETRY,
      framework: "unknown",
    },
    options
  );
};
