import type { RequestHandler } from "@sveltejs/kit";

import type { InvokableWorkflow, PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback, serveManyBase } from "../src/serve/serve-many";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "svelte",
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
  options: PublicServeOptions<TInitialPayload> & {
    env: PublicServeOptions["env"]; // make env required
  }
): {
  POST: RequestHandler;
} => {

  const handler: RequestHandler = async ({ request }) => {
    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, telemetry, {
      ...options,
      useJSONContent: true,
    });
    return await serveHandler(request);
  };
  return { POST: handler };
};


export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<
  TInitialPayload,
  TResult,
  Parameters<ReturnType<typeof serve<TInitialPayload, TResult>>["POST"]>
> => {
  const { POST } = serve(...params);
  return {
    callback: createInvokeCallback<TInitialPayload, TResult>(telemetry),
    handler: POST,
    workflowId: undefined,
  };
};

export const serveMany = (workflows: Parameters<typeof serveManyBase>[0]["workflows"]) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows: workflows,
      getWorkflowId(params) {
        const components = params.url.toString().split("/");
        return components[components.length - 1];
      },
    }).handler,
  };
};
