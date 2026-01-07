import type { RequestHandler } from "@sveltejs/kit";

import type { InvokableWorkflow, WorkflowServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { OmitOptionsInServeMany, serveManyBase } from "../src/serve/serve-many";

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
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options: WorkflowServeOptions<TInitialPayload, TResult> & {
    env: WorkflowServeOptions["env"]; // make env required
  }
): {
  POST: RequestHandler;
} => {
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
