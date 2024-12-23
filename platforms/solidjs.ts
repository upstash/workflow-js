import type { APIEvent } from "@solidjs/start/server";

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
  options?: PublicServeOptions<TInitialPayload>
) => {
  // Create a handler which receives an event and calls the
  // serveBase method
  const handler = async (event: APIEvent) => {
    // verify that the request is POST
    const method = event.request.method;
    if (method.toUpperCase() !== "POST") {
      return new Response("Only POST requests are allowed in worklfows", {
        status: 405,
      });
    }

    // create serve handler
    const { handler: serveHandler } = serveBase<TInitialPayload>(
      routeFunction,
      {
        sdk: SDK_TELEMETRY,
        platform: "solidjs",
        runtime: `node@${process.version}`,
      },
      options
    );

    return await serveHandler(event.request);
  };
  return { POST: handler };
};
