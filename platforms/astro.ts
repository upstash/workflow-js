import type { APIContext, APIRoute } from "astro";

import type { PublicServeOptions, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";

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
      options
    );

    return handler(apiContext.request);
  };

  return { POST };
}
