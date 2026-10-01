import type {
  WorkflowServeOptions,
  Telemetry,
  InvokableWorkflow,
  RouteFunction,
  ExclusiveValidationOptions,
} from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";
import { startDevServer } from "@upstash/qstash";

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
 * Code outside steps runs again on every request of the run. Anything it branches on or
 * returns early on (Date.now(), database rows, random values) must give the same answer on
 * every request, or later requests fail with "Incompatible step name" or "Failed to
 * authenticate Workflow request". Read such values inside `context.run` and branch on its
 * result.
 *
 * @param routeFunction workflow function that receives both workflow context and TanStack route context
 * @param options workflow options (same as Next.js serve options)
 * @returns handler object with POST method compatible with TanStack Start
 * @see node_modules/@upstash/workflow/docs/basics/serve.mdx
 * @see node_modules/@upstash/workflow/docs/quickstarts/tanstack-start.mdx
 */
export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: Omit<
    WorkflowServeOptions<TInitialPayload, TResult>,
    "schema" | "initialPayloadParser"
  > &
    ExclusiveValidationOptions<TInitialPayload>
) {
  void startDevServer();

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

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke.mdx
 */
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
 * @see node_modules/@upstash/workflow/docs/features/invoke/serveMany.mdx
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
