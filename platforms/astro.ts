import type { APIContext, APIRoute } from "astro";

import { PublicServeOptions, Telemetry, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback } from "../src/serve/serve-many";

export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: (
    workflowContext: WorkflowContext<TInitialPayload>,
    apiContext: APIContext
  ) => Promise<TResult>,
  options?: PublicServeOptions<TInitialPayload>
) {
  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "astro",
    runtime: process.versions.bun
      ? `bun@${process.versions.bun}/node@${process.version}`
      : `node@${process.version}`,
  };
  const POST: APIRoute = (apiContext) => {
    const { handler } = serveBase<TInitialPayload>(
      (workflowContext) => routeFunction(workflowContext, apiContext),
      telemetry,
      options
    );

    return handler(apiContext.request);
  };

  const workflowId = options?.workflowId;
  const invokeCallback = createInvokeCallback(workflowId, telemetry);

  return { POST, workflowId, invokeCallback };
}

// export const serveMany: ServeMany<typeof serve, "POST"> = ({ routes }) => {
//   return {
//     POST: serveManyBase<[APIContext]>({
//       routes: routes.map(route => {
//         return {
//           ...route,
//           handler: route.POST
//         }
//       }),
//       getHeader(header, params) {
//         const [context] = params
//         return context.request.headers.get(header)
//       },
//     }).handler
//   }
// }
