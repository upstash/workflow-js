import type { RequestHandler } from "@sveltejs/kit";

import type { PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback } from "../src/serve/serve-many";

/**
 * Serve method to serve a Upstash Workflow in a Nextjs project
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, unknown>,
  options: PublicServeOptions<TInitialPayload> & {
    env: PublicServeOptions["env"]; // make env required
  }
): {
  POST: RequestHandler;
  invokeWorkflow: ReturnType<typeof createInvokeCallback<TInitialPayload, TResult>>;
  workflowId: string | undefined;
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

  const invokeWorkflow = createInvokeCallback<TInitialPayload, TResult>(
    options?.workflowId,
    telemetry
  );
  return { POST: handler, invokeWorkflow, workflowId: options.workflowId };
};
