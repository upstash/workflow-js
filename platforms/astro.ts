import type { APIContext, APIRoute } from 'astro'

import type { WorkflowServeOptions, WorkflowContext } from "../src";
import { serve as serveBase } from "../src";

export function serveWorkflow<TInitialPayload = unknown>(
  routeFunction: (
    apiContext: APIContext,
    workflowContext: WorkflowContext<TInitialPayload>
  ) => Promise<void>,
  options?: WorkflowServeOptions<Response, TInitialPayload>
) {
  const POST: APIRoute = (apiContext) => {
    const { handler } = serveBase<TInitialPayload>(
      (workflowContext) => routeFunction(apiContext, workflowContext),
      options
    )

    return handler(apiContext.request)
  }

  return { POST }
}
