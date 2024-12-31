import type { RequestHandler } from "@sveltejs/kit";

import type { PublicServeOptions, RouteFunction } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";

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
    const { handler: serveHandler } = serveBase<TInitialPayload>(
      routeFunction,
      {
        sdk: SDK_TELEMETRY,
        framework: "svelte",
      },
      {
        ...options,
        useJSONContent: true,
      }
    );
    return await serveHandler(request);
  };

  return { POST: handler };
};
