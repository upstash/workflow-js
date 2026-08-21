import { makeCancelRequest } from "../client/utils";
import {
  SDK_TELEMETRY,
  WORKFLOW_CREATED_AT_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_LABEL_HEADER,
  WORKFLOW_ERROR_STEP_NAME_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_RETRIED_HEADER,
} from "../constants";
import { WorkflowContext } from "../context";
import {
  formatWorkflowError,
  getStepNameFromError,
  isInstanceOf,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from "../error";
import { MiddlewareManager } from "../middleware/manager";
import { RouteFunction, Telemetry, WorkflowServeOptions } from "../types";
import { getPayload, handleFailure, parseRequest, validateRequest } from "../workflow-parser";
import {
  handleThirdPartyCallResult,
  flushPendingStep,
  isThirdPartyCallResult,
  recreateUserHeaders,
  triggerFirstInvocation,
  triggerRouteFunction,
  triggerWorkflowDelete,
  verifyRequest,
} from "../workflow-requests";
import { getEffectiveConfig } from "../qstash/step-config";
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
  // Prepares options with defaults if they are not provided.

  const {
    initialPayloadParser,
    url,
    failureFunction,
    baseUrl,
    env,
    disableTelemetry,
    middlewares,
    internal,
  } = processOptions<TInitialPayload, TResult, TResponse>(options, internalOptions);
  telemetry = disableTelemetry ? undefined : telemetry;

  const { generateResponse: responseGenerator, useJSONContent } = internal;

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
    const retried = Number(request.headers.get(WORKFLOW_RETRIED_HEADER) ?? "0");
    const label = request.headers.get(WORKFLOW_LABEL_HEADER) ?? undefined;
    const workflowRunCreatedAt = request.headers.get(WORKFLOW_CREATED_AT_HEADER)!;

    // configuration QStash applied to this delivery, which the executor
    // compares a step's own settings against
    const effectiveConfig = getEffectiveConfig(request.headers as Headers);

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient: regionalClient,
      workflowRunId,
      initialPayload: isThirdPartyCallResult(request)
        ? JSON.parse(rawInitialPayload)
        : initialPayloadParser(rawInitialPayload),
      headers: recreateUserHeaders(request.headers as Headers),
      steps,
      effectiveConfig,
      url: workflowUrl,
      env,
      telemetry,
      invokeCount,
      label,
      retried,
      workflowRunCreatedAt: Number(workflowRunCreatedAt),
      middlewareManager,
    });

    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(
      routeFunction,
      workflowContext,
      effectiveConfig
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
      telemetry,
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
            telemetry,
            invokeCount,
            middlewareManager,
            unknownSdk,
          })
        : await triggerRouteFunction({
            onStep: async () => {
              if (steps.length === 1) {
                await middlewareManager.dispatchLifecycle("runStarted", {});
              }

              // A step whose result is available in-process (run, sleep,
              // sleepUntil, notify) is held rather than submitted, so the
              // route function can carry on and reveal what comes next.
              // However the function ends, that held result has to reach
              // QStash before this invocation does, so it is submitted on
              // every path out of here.
              let outcome: { ran: true; result: TResult } | { ran: false; error: unknown };
              try {
                outcome = { ran: true, result: await routeFunction(workflowContext) };
              } catch (error) {
                // Reached whenever the route function does not run to the
                // end. Usually that is the executor ending the invocation
                // on purpose — a WorkflowAbort once it submitted a step,
                // planned a parallel group or published a step config
                // request, or a cancel / non-retryable / retry-after — but
                // it is also where a step function or the code around it
                // failing arrives. They are told apart below and in
                // triggerRouteFunction; the submission comes first either
                // way.
                outcome = { ran: false, error };
              }

              const submitted = await flushPendingStep(workflowContext);

              if (submitted.isErr()) {
                // Reached when a step was held and its result could not be
                // published. The step ran but the run has no record of it,
                // so nothing else that happened matters: surface the
                // failure and let QStash retry this delivery, which
                // replays the step rather than losing it.
                throw submitted.error;
              }

              if (submitted.value.result === "submitted-step") {
                // Reached when a step ran in this invocation and was held:
                // either the function returned straight after it, or it
                // reached a further step, which submitted the held one and
                // threw this same abort on the way out. Its result is now
                // with QStash, so the invocation ends as a finished step
                // and the run carries on in the delivery that submission
                // produces.
                //
                // An error the function threw after running that step is
                // dropped here. It happens again on the next delivery,
                // where the step is memoized and nothing is held to take
                // precedence over it.
                throw submitted.value.abort;
              }

              if (!outcome.ran) {
                // Reached when the function did not run to the end and no
                // step was held — nothing ran in this invocation, or what
                // ran submitted itself (a call, an invoke, a wait, a
                // parallel group). triggerRouteFunction decides whether
                // this ends the invocation as a finished step or fails the
                // run.
                throw outcome.error;
              }

              // Reached when the function ran to the end without executing
              // a step here: every step it passed was already recorded, so
              // there is nothing left to submit and the run is finished.
              return outcome.result;
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
    const middlewareManager = new MiddlewareManager<TInitialPayload, TResult>(middlewares);

    try {
      return await handler(request, middlewareManager);
    } catch (error) {
      const formattedError = formatWorkflowError(error);
      await middlewareManager.dispatchDebug("onError", {
        error: isInstanceOf(error, Error) ? error : new Error(formattedError.message),
      });
      // if the error happened while executing a known step, report its name so
      // it can be shown in Workflow Logs when the step is retried.
      const stepName = getStepNameFromError(error)
        // strip control characters (e.g. CR/LF) so an invalid step name
        // can't produce an invalid header value and break the 500 response
        // eslint-disable-next-line no-control-regex
        ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
        .trim();
      return new Response(JSON.stringify(formattedError), {
        status: 500,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          ...(stepName ? { [WORKFLOW_ERROR_STEP_NAME_HEADER]: stepName } : {}),
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
