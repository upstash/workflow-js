import type { RequestHandler } from "@sveltejs/kit";

import type { InvokableWorkflow, WorkflowServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { OmitOptionsInServeMany, serveManyBase } from "../src/serve/serve-many";
import { startDevServer } from "@upstash/qstash";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "svelte",
};

type RequireEnv<T> = T & {
  env: WorkflowServeOptions["env"]; // make env required
};

/**
 * Serve method to serve a Upstash Workflow in a Svelte project
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * Code outside steps runs again on every request of the run. Anything it branches on or
 * returns early on (Date.now(), database rows, random values) must give the same answer on
 * every request, or later requests fail with "Incompatible step name" or "Failed to
 * authenticate Workflow request". Read such values inside `context.run` and branch on its
 * result.
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 * @see node_modules/@upstash/workflow/docs/basics/serve.mdx
 * @see node_modules/@upstash/workflow/docs/quickstarts/svelte.mdx
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options: WorkflowServeOptions<TInitialPayload, TResult> & {
    env: WorkflowServeOptions["env"]; // make env required
  }
): {
  POST: RequestHandler;
} => {
  void startDevServer();

  const handler: RequestHandler = async ({ request }) => {
    const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response, TResult>(
      routeFunction,
      telemetry,
      options,
      {
        useJSONContent: true,
      }
    );
    return await serveHandler(request);
  };
  return { POST: handler };
};

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke.mdx
 */
export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    workflowId: undefined,
    routeFunction,
    options,
    useJSONContent: true,
  };
};

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke/serveMany.mdx
 */
export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  type Params = Parameters<typeof serve>;

  return {
    POST: serveManyBase<
      ReturnType<typeof serve>["POST"],
      OmitOptionsInServeMany<Params[1]>,
      [Params[0], RequireEnv<Params[1]>]
    >({
      workflows: workflows,
      getUrl(params) {
        return params.url.toString();
      },
      options,
      serveMethod: (routeFunction, serveOptions) => {
        return serve(routeFunction, serveOptions).POST;
      },
    }).handler,
  };
};
