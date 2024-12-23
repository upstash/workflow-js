import type { APIContext, APIRoute } from "astro";

import { PublicServeOptions, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";

export function serve<TInitialPayload = unknown>(
  routeFunction: (
    workflowContext: WorkflowContext<TInitialPayload>,
    apiContext: APIContext
  ) => Promise<void>,
  options?: PublicServeOptions<TInitialPayload>
) {
  const POST: APIRoute = (apiContext) => {
    const { handler } = serveBase<TInitialPayload>(
      (workflowContext) => routeFunction(workflowContext, apiContext),
      {
        sdk: SDK_TELEMETRY,
        platform: "astro",
        runtime: `node@${process.version}`,
      },
      options
    );

    return handler(apiContext.request);
  };

  return { POST };
}
