import { serveBase } from ".";
import { UPSTASH_WORKFLOW_ROUTE_HEADER } from "../constants";
import { WorkflowError } from "../error";
import { InvokeWorkflowRequest, ServeFunction, Telemetry } from "../types";
import { getHeaders } from "../workflow-requests";

export const serveManyBase = <THandlerParams extends unknown[]>({
  routes,
  defaultRoute,
  getHeader,
}: {
  routes: Record<string, {
    handler: (...params: THandlerParams) => Promise<Response>,
    workflowId?: string
  }>;
  defaultRoute: { handler: (...params: THandlerParams) => Promise<Response> },
  getHeader: (header: string, params: THandlerParams) => string | null;
}) => {
  // let defaultRoute: undefined | ((...params: THandlerParams) => Promise<Response>);
  const routeIds: (string | undefined)[] = [];

  const routeMap: Record<string, (...params: THandlerParams) => Promise<Response>> =
    Object.fromEntries(
      Object.entries(routes).map(route => {
        const routeId = route[0]

        if (routeIds.includes(routeId)) {
          throw new WorkflowError(
            `Duplicate workflowId found: ${routeId}. Please set different route names in serveMany.`
          );
        }

        route[1].workflowId = routeId

        return [routeId, route[1].handler]
      })
    );

  return {
    handler: async (...params: THandlerParams) => {
      const routeChoice = getHeader(UPSTASH_WORKFLOW_ROUTE_HEADER, params);
      if (!routeChoice) {
        if (!defaultRoute) {
          throw new WorkflowError(
            `Unexpected route in serveMany: '${routeChoice}'. Please set a default route or pass ${UPSTASH_WORKFLOW_ROUTE_HEADER}`
          );
        }
        return await defaultRoute.handler(...params);
      }
      const route = routeMap[routeChoice];
      if (!route) {
        throw new WorkflowError(`No routes in serveMany found for '${routeChoice}'`);
      }
      return await route(...params);
    },
  };
};

export const createInvokeCallback = <TInitialPayload, TResult>(
  workflowId: string | undefined,
  telemetry: Telemetry | undefined
) => {
  const invokeWorkflow: ServeFunction<TResult, TInitialPayload> = async (
    settings,
    invokeStep,
    context
  ) => {
    if (!workflowId) {
      throw new WorkflowError("You can only invoke workflow which have workflowId");
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

    headers["Upstash-Workflow-Runid"] = context.workflowRunId;

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
      headers: Object.fromEntries(Object.entries(headers).map((pairs) => [pairs[0], [pairs[1]]])),
      workflowRunId: settings.workflowRunId,
      workflowUrl: context.url,
      step: invokeStep,
    };

    await context.qstashClient.publish({
      headers: triggerHeaders,
      method: "POST",
      body: JSON.stringify(request),
      url: context.url,
    });

    return undefined as TResult;
  };

  return invokeWorkflow;
};
