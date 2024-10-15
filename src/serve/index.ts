import { WorkflowContext } from "../context";
import { formatWorkflowError } from "../error";
import { WorkflowLogger } from "../logger";
import { RouteFunction, WorkflowServeOptions } from "../types";
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
import { determineUrls, processOptions } from "./options";

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
>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: WorkflowServeOptions<TResponse, TInitialPayload>
): { handler: ((request: TRequest) => Promise<TResponse>) } => {
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
  } = processOptions<TResponse, TInitialPayload>(options);
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
    const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
      requestPayload,
      isFirstInvocation,
      debug
    );

    // terminate current call if it's a duplicate branch
    if (isLastDuplicate) {
      return onStepFinish("no-workflow-id", "duplicate-step");
    }

    // check if the request is a failure callback
    const failureCheck = await handleFailure<TInitialPayload>(
      request,
      requestPayload,
      qstashClient,
      initialPayloadParser,
      failureFunction
    );
    if (failureCheck.isErr()) {
      // unexpected error during handleFailure
      throw failureCheck.error;
    } else if (failureCheck.value === "is-failure-callback") {
      // is a failure ballback.
      await debug?.log("WARN", "RESPONSE_DEFAULT", "failureFunction executed");
      return onStepFinish("no-workflow-id", "failure-callback");
    }

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: initialPayloadParser(rawInitialPayload),
      rawInitialPayload,
      headers: recreateUserHeaders(request.headers as Headers),
      steps,
      url: workflowUrl,
      failureUrl: workflowFailureUrl,
      debug,
      env,
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
      return onStepFinish("no-workflow-id", "auth-fail");
    }

    // check if request is a third party call result
    const callReturnCheck = await handleThirdPartyCallResult(
      request,
      rawInitialPayload,
      qstashClient,
      workflowUrl,
      workflowFailureUrl,
      retries,
      debug
    );
    if (callReturnCheck.isErr()) {
      // error while checking
      await debug?.log("ERROR", "SUBMIT_THIRD_PARTY_RESULT", {
        error: callReturnCheck.error.message,
      });
      throw callReturnCheck.error;
    } else if (callReturnCheck.value === "continue-workflow") {
      // request is not third party call. Continue workflow as usual
      const result = isFirstInvocation
        ? await triggerFirstInvocation(workflowContext, retries, debug)
        : await triggerRouteFunction({
            onStep: async () => routeFunction(workflowContext),
            onCleanup: async () => {
              await triggerWorkflowDelete(workflowContext, debug);
            },
          });

      if (result.isErr()) {
        // error while running the workflow or when cleaning up
        await debug?.log("ERROR", "ERROR", { error: result.error.message });
        throw result.error;
      }

      // Returns a Response with `workflowRunId` at the end of each step.
      await debug?.log("INFO", "RESPONSE_WORKFLOW");
      return onStepFinish(workflowContext.workflowRunId, "success");
    }
    // response to QStash in call cases
    await debug?.log("INFO", "RESPONSE_DEFAULT");
    return onStepFinish("no-workflow-id", "fromCallback");
  };

  const safeHandler = async (request: TRequest) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify(formatWorkflowError(error)), {
        status: 500,
      }) as TResponse;
    }
  };

  return { handler: safeHandler }
};
