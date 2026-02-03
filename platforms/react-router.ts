import type { WorkflowServeOptions, RouteFunction, Telemetry, InvokableWorkflow } from "../src";
import { SDK_TELEMETRY } from "../src/constants";
import { serveBase } from "../src/serve";
import { serveManyBase } from "../src/serve/serve-many";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "react-router",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
};

/**
 * Serve method to serve an Upstash Workflow in a React Router v7 project
 *
 * Use this in your route's action function to handle workflow requests.
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * @example
 * ```tsx
 * import { serve } from "@upstash/workflow/react-router";
 *
 * export const action = serve<{ message: string }>(
 *   async (context) => {
 *     const input = context.requestPayload;
 *     await context.sleep("sleep", 10);
 *     console.log("Workflow completed:", input.message);
 *   }
 * );
 * ```
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns action function compatible with React Router v7
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
) => {
  const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response, TResult>(
    routeFunction,
    telemetry,
    options
  );

  return async ({ request }: { request: Request }): Promise<Response> => {
    return await serveHandler(request);
  };
};

export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    routeFunction,
    options,
    workflowId: undefined,
  };
};

export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return serveManyBase<ReturnType<typeof serve>>({
    workflows: workflows,
    getUrl(params) {
      return params.request.url;
    },
    serveMethod: (...params: Parameters<typeof serve>) => serve(...params),
    options,
  }).handler;
};
