import { SDK_TELEMETRY } from "../constants";
import { ContextFactory } from "../context/factory";
import { formatWorkflowError } from "../error";
import { WorkflowLogger } from "../logger";
import { RouteFunction, Telemetry, WorkflowServeOptions } from "../types";
import { getPayload } from "../workflow-parser";
import { verifyRequest } from "../workflow-requests";
import { getClaim } from "./claim";
import { resolveUrls, processOptions } from "./options";

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
>(
  routeFunction: RouteFunction<TInitialPayload>,
  telemetry: Telemetry,
  options?: WorkflowServeOptions<TResponse, TInitialPayload>
): { handler: (request: TRequest) => Promise<TResponse> } => {
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
    useJSONContent,
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
    await debug?.log("INFO", "ENDPOINT_START");

    // get payload as raw string
    const requestPayload = (await getPayload(request)) ?? "";
    await verifyRequest(requestPayload, request.headers.get("upstash-signature"), receiver);

    const { workflowUrl, workflowFailureUrl } = await resolveUrls(
      request,
      url,
      baseUrl,
      failureFunction,
      failureUrl,
      debug
    );

    // check claim
    const claim = getClaim({ headers: request.headers });
    return await ContextFactory.fromClaim<TInitialPayload, TResponse>(claim, {
      rawRequestPayload: requestPayload,
      rawHeaders: request.headers,
      env,
      debug,
      initialPayloadParser,
      failureFunction,
      onStepFinish,
      retries,
      routeFunction,
      telemetry,
      qstashClient,
      useJSONContent,
      workflowUrl,
      workflowFailureUrl,
    });
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
>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: Omit<WorkflowServeOptions<TResponse, TInitialPayload>, "useJSONContent">
): { handler: (request: TRequest) => Promise<TResponse> } => {
  return serveBase(
    routeFunction,
    {
      sdk: SDK_TELEMETRY,
      platform: "unknown",
    },
    options
  );
};
