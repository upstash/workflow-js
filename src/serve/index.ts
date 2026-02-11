import { makeCancelRequest } from "../client/utils";
import {
  SDK_TELEMETRY,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_LABEL_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "../constants";
import { WorkflowContext } from "../context";
import { getDevCredentials } from "../dev-server";
import {
  formatWorkflowError,
  isInstanceOf,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from "../error";
import { MiddlewareManager } from "../middleware/manager";
import { RouteFunction, Telemetry, WorkflowServeOptions } from "../types";
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
import { getHandlersForRequest } from "./multi-region/handlers";
import {
  AUTH_FAIL_MESSAGE,
  createResponseData,
  determineUrls,
  processOptions,
  InternalServeOptions,
} from "./options";

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
  options?: WorkflowServeOptions<TInitialPayload, TResult>,
  internalOptions?: Partial<InternalServeOptions<TResponse>>
): {
  handler: (request: TRequest) => Promise<TResponse>;
} => {
  // Detect dev mode from the environment
  const environment =
    options?.env ?? (typeof process === "undefined" ? ({} as Record<string, string>) : process.env);
  const devMode = environment.WORKFLOW_DEV === "true";

  // In dev mode, inject the well-known dev credentials immediately so
  // processOptions can create the QStash client without waiting for the server.
  if (devMode) {
    const port = Number(environment.WORKFLOW_DEV_PORT) || 8080;
    const creds = getDevCredentials(port);
    for (const [k, v] of Object.entries(creds)) {
      if (!environment[k]) {
        environment[k] = v;
      }
    }
  }

  type ProcessedOptions = ReturnType<typeof processOptions<TInitialPayload, TResult, TResponse>>;
  const resolvedOptions: ProcessedOptions = processOptions<TInitialPayload, TResult, TResponse>(
    options,
    internalOptions
  );

  /**
   * Handles the incoming request, triggering the appropriate workflow steps.
   * Calls `triggerFirstInvocation()` if it's the first invocation.
   * Otherwise, starts calling `triggerRouteFunction()` to execute steps in the workflow.
   * Finally, calls `triggerWorkflowDelete()` to remove the workflow from QStash.
   *
   * @param request - The incoming request to handle.
   * @returns A promise that resolves to a response.
   */
  const handler = async (
    request: TRequest,
    middlewareManager: MiddlewareManager<TInitialPayload, TResult>
  ) => {
    const {
      initialPayloadParser,
      url,
      failureFunction,
      baseUrl,
      env,
      disableTelemetry: optDisableTelemetry,
      internal,
    } = resolvedOptions;
    const currentTelemetry = optDisableTelemetry ? undefined : telemetry;
    const { generateResponse: responseGenerator, useJSONContent } = internal;
    await middlewareManager.dispatchDebug("onInfo", {
      info: `Received request for workflow execution.`,
    });

    const { workflowUrl } = await determineUrls(
      request,
      url,
      baseUrl,
      middlewareManager.dispatchDebug.bind(middlewareManager)
    );

    // validation & parsing to get isFirstInvocation early
    const { isFirstInvocation, workflowRunId, unknownSdk } = validateRequest(request);

    // Get the appropriate handlers based on region
    const regionHeader = request.headers.get("upstash-region");
    const { client: regionalClient, receiver: regionalReceiver } = getHandlersForRequest(
      internal.qstashHandlers,
      regionHeader,
      isFirstInvocation
    );

    // get payload as raw string
    const requestPayload = (await getPayload(request)) ?? "";
    await verifyRequest(requestPayload, request.headers.get("upstash-signature"), regionalReceiver);

    middlewareManager.assignWorkflowRunId(workflowRunId);
    await middlewareManager.dispatchDebug("onInfo", {
      info: `Run id identified. isFirstInvocation: ${isFirstInvocation}, unknownSdk: ${unknownSdk}`,
    });

    // parse steps
    const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest({
      requestPayload,
      isFirstInvocation,
      unknownSdk,
      workflowRunId,
      requester: regionalClient.http,
      messageId: request.headers.get("upstash-message-id")!,
      dispatchDebug: middlewareManager.dispatchDebug.bind(middlewareManager),
    });

    if (workflowRunEnded) {
      return responseGenerator(
        createResponseData(workflowRunId, {
          condition: "workflow-already-ended",
        })
      );
    }

    // terminate current call if it's a duplicate branch
    if (isLastDuplicate) {
      return responseGenerator(
        createResponseData(workflowRunId, {
          condition: "duplicate-step",
        })
      );
    }

    // check if the request is a failure callback
    const failureCheck = await handleFailure<TInitialPayload>({
      request,
      requestPayload,
      qstashClient: regionalClient,
      initialPayloadParser,
      routeFunction,
      failureFunction,
      env,
      dispatchDebug: middlewareManager.dispatchDebug.bind(middlewareManager),
    });
    if (failureCheck.isErr()) {
      // unexpected error during handleFailure
      throw failureCheck.error;
    } else if (failureCheck.value.result === "failure-function-executed") {
      // is a failure ballback.
      await middlewareManager.dispatchDebug("onInfo", {
        info: `Handled failure callback.`,
      });
      return responseGenerator(
        createResponseData(workflowRunId, {
          condition: "failure-callback-executed",
          result: failureCheck.value.response,
        })
      );
    } else if (failureCheck.value.result === "failure-function-undefined") {
      await middlewareManager.dispatchDebug("onInfo", {
        info: `Failure callback invoked but no failure function defined.`,
      });
      return responseGenerator(
        createResponseData(workflowRunId, {
          condition: "failure-callback-undefined",
        })
      );
    }

    const invokeCount = Number(request.headers.get(WORKFLOW_INVOKE_COUNT_HEADER) ?? "0");
    const label = request.headers.get(WORKFLOW_LABEL_HEADER) ?? undefined;

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient: regionalClient,
      workflowRunId,
      initialPayload: initialPayloadParser(rawInitialPayload),
      headers: recreateUserHeaders(request.headers as Headers),
      steps,
      url: workflowUrl,
      env,
      telemetry: currentTelemetry,
      invokeCount,
      label,
      middlewareManager,
    });

    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(
      routeFunction,
      workflowContext
    );
    if (authCheck.isErr()) {
      // got error while running until first step
      throw authCheck.error;
    } else if (authCheck.value === "run-ended") {
      // finished routeFunction while trying to run until first step.
      // either there is no step or auth check resulted in `return`
      await middlewareManager.dispatchDebug("onError", {
        error: new Error(AUTH_FAIL_MESSAGE),
      });
      return responseGenerator(
        createResponseData(isFirstInvocation ? "no-workflow-id" : workflowContext.workflowRunId, {
          condition: "auth-fail",
        })
      );
    }

    // check if request is a third party call result
    const callReturnCheck = await handleThirdPartyCallResult({
      request,
      requestPayload: rawInitialPayload,
      client: regionalClient,
      workflowUrl,
      telemetry: currentTelemetry,
      middlewareManager,
    });
    if (callReturnCheck.isErr()) {
      throw callReturnCheck.error;
    } else if (callReturnCheck.value === "continue-workflow") {
      // request is not third party call. Continue workflow as usual
      const result = isFirstInvocation
        ? await triggerFirstInvocation({
            workflowContext,
            useJSONContent,
            telemetry: currentTelemetry,
            invokeCount,
            middlewareManager,
            unknownSdk,
          })
        : await triggerRouteFunction({
            onStep: async () => {
              if (steps.length === 1) {
                await middlewareManager.dispatchLifecycle("runStarted", {});
              }
              return await routeFunction(workflowContext);
            },
            onCleanup: async (result) => {
              await middlewareManager.dispatchLifecycle("runCompleted", {
                result,
              });
              await triggerWorkflowDelete(
                workflowContext,
                result,
                false,
                middlewareManager.dispatchDebug.bind(middlewareManager)
              );
            },
            onCancel: async () => {
              await makeCancelRequest(workflowContext.qstashClient.http, workflowRunId);
            },
            middlewareManager,
          });

      if (result.isOk() && isInstanceOf(result.value, WorkflowNonRetryableError)) {
        return responseGenerator(
          createResponseData(workflowRunId, {
            condition: "non-retryable-error",
            result: result.value,
          })
        );
      }

      if (result.isOk() && isInstanceOf(result.value, WorkflowRetryAfterError)) {
        return responseGenerator(
          createResponseData(workflowRunId, {
            condition: "retry-after-error",
            result: result.value,
          })
        );
      }

      if (result.isErr()) {
        // error while running the workflow or when cleaning up
        throw result.error;
      }

      // Returns a Response with `workflowRunId` at the end of each step.
      await middlewareManager.dispatchDebug("onInfo", {
        info: `Workflow endpoint execution completed successfully.`,
      });
      return responseGenerator(
        createResponseData(workflowContext.workflowRunId, {
          condition: "success",
        })
      );
    } else if (callReturnCheck.value === "workflow-ended") {
      return responseGenerator(
        createResponseData(workflowContext.workflowRunId, {
          condition: "workflow-already-ended",
        })
      );
    }
    // response to QStash in call cases
    return responseGenerator(
      createResponseData(workflowContext.workflowRunId, {
        condition: "fromCallback",
      })
    );
  };

  const safeHandler = async (request: TRequest) => {
    // Create middleware manager for this request
    const middlewareManager = new MiddlewareManager<TInitialPayload, TResult>(
      resolvedOptions.middlewares
    );

    try {
      return await handler(request, middlewareManager);
    } catch (error) {
      const formattedError = formatWorkflowError(error);
      await middlewareManager.dispatchDebug("onError", {
        error: isInstanceOf(error, Error) ? error : new Error(formattedError.message),
      });
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
 * @param options - Options including the client and initialPayloadParser.
 * @returns An async method that consumes incoming requests and runs the workflow.
 */
export const serve = <
  TInitialPayload = unknown,
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TResult = unknown,
>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
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
