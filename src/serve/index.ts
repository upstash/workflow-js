import { makeCancelRequest } from "../client/utils";
import { SDK_TELEMETRY, UPSTASH_WORKFLOW_ROUTE_HEADER } from "../constants";
import { WorkflowContext } from "../context";
import { formatWorkflowError, WorkflowError } from "../error";
import { WorkflowLogger } from "../logger";
import {
  ExclusiveValidationOptions,
  PublicServeOptions,
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
>(
  routeFunction: RouteFunction<TInitialPayload, unknown>,
  telemetry?: Telemetry,
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
    disableTelemetry,
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
            onCleanup: async () => {
              await triggerWorkflowDelete(workflowContext, debug);
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
  TRoutePayloads = unknown,
>(
  routeFunction: RouteFunction<TInitialPayload, TRoutePayloads>,
  options?: Omit<
    WorkflowServeOptions<TResponse, TInitialPayload>,
    "useJSONContent" | "schema" | "initialPayloadParser"
  > &
    ExclusiveValidationOptions<TInitialPayload>
): { handler: (request: TRequest) => Promise<TResponse> } => {
  return serveBase(
    routeFunction,
    {
      sdk: SDK_TELEMETRY,
      framework: "unknown",
    },
    options
  );
};

type Route<TPayload, TRoutePayloads> = ReturnType<
  typeof serve<TPayload, Request, Response, TRoutePayloads>
>;

type Routes<TRoutePayloads> = {
  [K in keyof TRoutePayloads]: Route<TRoutePayloads[K], TRoutePayloads>;
};

export const serveMany = <TRoutePayloads>({
  routes,
  defaultRoute,
}: {
  routes: {
    [K in keyof TRoutePayloads]: {
      route: RouteFunction<TRoutePayloads[K], TRoutePayloads>;
      options?: PublicServeOptions<TRoutePayloads[K]>;
    };
  };
  defaultRoute?: keyof TRoutePayloads;
}) => {
  const mappedRoutes = Object.fromEntries(
    Object.entries(routes).map(([routeName, routeParams]) => {
      const { route, options } = routeParams as {
        route: RouteFunction<unknown>;
        options: PublicServeOptions;
      };

      return [routeName, serve(route, options)];
    })
  ) as Routes<TRoutePayloads>;

  return {
    POST: async (request: Request) => {
      const routeChoice =
        request.headers.get(UPSTASH_WORKFLOW_ROUTE_HEADER) ?? (defaultRoute as string);

      if (!routeChoice) {
        throw new WorkflowError(
          `Unexpected route: '${routeChoice}'. Please set a default route or pass ${UPSTASH_WORKFLOW_ROUTE_HEADER}`
        );
      }

      const route = (mappedRoutes as Record<string, ReturnType<typeof serve>>)[routeChoice];

      if (!route) {
        throw new WorkflowError(`No routes found for '${routeChoice}'`);
      }

      return await route.handler(request);
    },
  };
};
