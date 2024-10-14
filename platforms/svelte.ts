import type { RequestHandler } from "@sveltejs/kit";

import type { RouteFunction, WorkflowServeOptions } from "../src";
import { serve as serveBase } from "../src";

/**
 * Serve method to serve a Upstash Workflow in a Nextjs project
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 */
export const serve = <TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload>,
  options: Omit<WorkflowServeOptions<Response, TInitialPayload>, "onStepFinish"> & {
    env: WorkflowServeOptions["env"];
  }
): RequestHandler => {
  const handler: RequestHandler = async ({ request }) => {
    const serveMethod = serveBase<TInitialPayload>(routeFunction, options);
    return await serveMethod(request);
  };

  return handler;
};
