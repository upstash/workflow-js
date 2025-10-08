import type { PublicServeOptions, Telemetry, InvokableWorkflow, RouteFunction } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "tanstack",
  runtime: `node@${process.version}`,
};

/**
 * Serve method to serve a Upstash Workflow in a TanStack Start project
 *
 * This wrapper allows you to access both the workflow context and TanStack route context
 *
 * @param routeFunction workflow function that receives both workflow context and TanStack route context
 * @param options workflow options (same as Next.js serve options)
 * @returns handler object with POST method compatible with TanStack Start
 */
export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
) {
  const POST = (tanstackContext: { request: Request }) => {
    // Create a Next.js compatible handler that passes the route context
    const { handler } = serveBase<TInitialPayload, Request, Response, TResult>(
      routeFunction,
      telemetry,
      options
    );

    return handler(tanstackContext.request);
  };

  return { POST };
}

export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    options,
    workflowId: undefined,
    routeFunction,
  };
};

/**
 * Serve multiple workflows from a single endpoint using dynamic routing in TanStack Start
 *
 * @param workflows object containing workflow definitions
 * @param options serve options
 * @returns handler object with POST method
 */
export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows,
      getUrl(context) {
        return context.request.url;
      },
      serveMethod: (...params: Parameters<typeof serve>) => serve(...params).POST,
      options,
    }).handler,
  };
};
