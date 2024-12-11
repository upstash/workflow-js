import type { APIContext, APIRoute } from "astro";

import type { PublicServeOptions, WorkflowContext } from "../src";
import { serve as serveBase } from "../src";

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
