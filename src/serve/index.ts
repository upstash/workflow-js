import { makeCancelRequest } from "../client/utils";
import { SDK_TELEMETRY, UPSTASH_WORKFLOW_ROUTE_HEADER } from "../constants";
import { WorkflowContext } from "../context";
import { formatWorkflowError, WorkflowError } from "../error";
import { WorkflowLogger } from "../logger";
import {
  ExclusiveValidationOptions,
  InvokeWorkflowRequest,
  RouteFunction,
  ServeFunction,
  Telemetry,
  WorkflowServeOptions,
} from "../types";
import { getPayload, handleFailure, parseRequest, validateRequest } from "../workflow-parser";
import {
  getHeaders,
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
  TWorkflowId extends string = string,
>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  telemetry?: Telemetry,
  options?: WorkflowServeOptions<TResponse, TInitialPayload, TWorkflowId>
): {
  handler: (request: TRequest) => Promise<TResponse>;
  workflow: ServeFunction<TResult, TInitialPayload>;
  workflowId?: string;
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
    useJSONContent,
    disableTelemetry,
    workflowId,
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
      return onStepFinish(workflowRunId, "workflow-already-ended");
    }

    // terminate current call if it's a duplicate branch
    if (isLastDuplicate) {
      return onStepFinish(workflowRunId, "duplicate-step");
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
      debug
    );
    if (failureCheck.isErr()) {
      // unexpected error during handleFailure
      throw failureCheck.error;
    } else if (failureCheck.value === "is-failure-callback") {
      // is a failure ballback.
      await debug?.log("WARN", "RESPONSE_DEFAULT", "failureFunction executed");
      return onStepFinish(workflowRunId, "failure-callback");
    }

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
      telemetry,
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
        "auth-fail"
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
        ? await triggerFirstInvocation({ workflowContext, useJSONContent, telemetry, debug })
        : await triggerRouteFunction({
            onStep: async () => routeFunction(workflowContext),
            onCleanup: async (result) => {
              await triggerWorkflowDelete(workflowContext, result, debug);
            },
            onCancel: async () => {
              await makeCancelRequest(workflowContext.qstashClient.http, workflowRunId);
            },
            debug,
          });

      if (result.isErr()) {
        // error while running the workflow or when cleaning up
        await debug?.log("ERROR", "ERROR", { error: result.error.message });
        throw result.error;
      }

      // Returns a Response with `workflowRunId` at the end of each step.
      await debug?.log("INFO", "RESPONSE_WORKFLOW");
      return onStepFinish(workflowContext.workflowRunId, "success");
    } else if (callReturnCheck.value === "workflow-ended") {
      return onStepFinish(workflowContext.workflowRunId, "workflow-already-ended");
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

  const workflow: ServeFunction<TResult, TInitialPayload> = async (
    settings,
    invokeStep,
    context
  ) => {
    if (!workflowId) {
      throw new WorkflowError("You can only invoke workflow which have workflowRunId");
    }

    const { headers } = getHeaders({
      initHeaderValue: "false",
      workflowRunId: context.workflowRunId,
      workflowUrl: context.url,
      userHeaders: context.headers,
      failureUrl: context.failureUrl,
      retries: context.retries,
      telemetry: telemetry,
    });
    
    const { headers: triggerHeaders } = getHeaders({
      initHeaderValue: "true",
      workflowRunId: settings.workflowRunId,
      workflowUrl: context.url,
      userHeaders: new Headers(settings.headers) as Headers,
      telemetry,
    });
    triggerHeaders[`Upstash-Forward-${UPSTASH_WORKFLOW_ROUTE_HEADER}`] = workflowId;
    triggerHeaders["Upstash-Workflow-Invoke"] = "true";

    const request: InvokeWorkflowRequest = {
      body: typeof settings.body === "string" ? settings.body : JSON.stringify(settings.body),
      headers: Object.fromEntries(Object.entries(headers).map(pairs => [pairs[0], [pairs[1]]])),
      workflowRunId: settings.workflowRunId,
      workflowUrl: context.url,
      step: invokeStep,
    };
    console.log(triggerHeaders);
    console.log(request);
    
    

    await context.qstashClient.publish({
      headers: triggerHeaders,
      method: "POST",
      body: JSON.stringify(request),
      url: context.url,
    });

    return undefined as TResult;
  };

  return { handler: safeHandler, workflow, workflowId };
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
): {
  handler: (request: TRequest) => Promise<TResponse>;
  workflow: ServeFunction<TResult, TInitialPayload>;
} => {
  return serveBase(
    routeFunction,
    {
      sdk: SDK_TELEMETRY,
      framework: "unknown",
    },
    options
  );
};

export const serveMany = <TWorkflowIds extends string[] = string[]>(routes: {
  [K in keyof TWorkflowIds]: { POST: (request: Request) => Promise<Response>; workflowId?: string };
}) => {
  let defaultRoute: undefined | ((request: Request) => Promise<Response>);
  const routeIds: (string | undefined)[] = [];
  const routeMap: Record<string, (request: Request) => Response> = Object.fromEntries(
    routes.map((route) => {
      const { workflowId, POST } = route;

      if (routeIds.includes(workflowId)) {
        throw new WorkflowError(
          `duplicate workflowId found: ${workflowId}. please set different workflowIds.`
        );
      }

      if (workflowId === undefined) {
        defaultRoute = POST;
      }
      return [workflowId, POST];
    })
  );
  return {
    POST: async (request: Request) => {
      const routeChoice = request.headers.get(UPSTASH_WORKFLOW_ROUTE_HEADER);
      if (!routeChoice) {
        if (!defaultRoute) {
          throw new WorkflowError(
            `Unexpected route: '${routeChoice}'. Please set a default route or pass ${UPSTASH_WORKFLOW_ROUTE_HEADER}`
          );
        }
        return await defaultRoute(request);
      }
      const route = routeMap[routeChoice];
      if (!route) {
        throw new WorkflowError(`No routes found for '${routeChoice}'`);
      }
      return await route(request);
    },
  };
};
