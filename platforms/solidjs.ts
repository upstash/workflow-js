import type { APIEvent } from "@solidjs/start/server";

import type { WorkflowServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { startDevServer } from "@upstash/qstash";

/**
 * Serve method to serve a Upstash Workflow in a SolidJS project
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
 * @see node_modules/@upstash/workflow/docs/quickstarts/solidjs.mdx
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
) => {
  void startDevServer();

  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "solidjs",
    runtime: process.versions.bun
      ? `bun@${process.versions.bun}/node@${process.version}`
      : `node@${process.version}`,
  };
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
    const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response, TResult>(
      routeFunction,
      telemetry,
      options
    );

    return await serveHandler(event.request);
  };
  return { POST: handler };
};
