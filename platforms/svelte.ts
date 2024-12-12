import type { RequestHandler } from "@sveltejs/kit";

import type { PublicServeOptions, RouteFunction } from "../src";
import { serveBase } from "../src/serve";

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
  options: PublicServeOptions<TInitialPayload> & {
    env: PublicServeOptions["env"]; // make env required
  }
): { POST: RequestHandler } => {
  const handler: RequestHandler = async ({ request }) => {
    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, {
      ...options,
      useJSONContent: true,
    });
    return await serveHandler(request);
  };

  return { POST: handler };
};
