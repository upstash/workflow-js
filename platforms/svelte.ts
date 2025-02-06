import type { RequestHandler } from "@sveltejs/kit";

import type { PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";

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
  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "svelte",
  };
  const handler: RequestHandler = async ({ request }) => {
    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, telemetry, {
      ...options,
      useJSONContent: true,
    });
    return await serveHandler(request);
  };
  return { POST: handler };
};
