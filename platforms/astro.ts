import type { APIContext, APIRoute } from "astro";

import { InvokableWorkflow, PublicServeOptions, Telemetry, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback, serveManyBase } from "../src/serve/serve-many";


const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "astro",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
};

export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: (
    workflowContext: WorkflowContext<TInitialPayload>,
    apiContext: APIContext
  ) => Promise<TResult>,
  options?: PublicServeOptions<TInitialPayload>
) {
  const POST: APIRoute = (apiContext) => {
    const { handler } = serveBase<TInitialPayload>(
      (workflowContext) => routeFunction(workflowContext, apiContext),
      telemetry,
      options
    );

    return handler(apiContext.request);
  };

  return { POST };
}

export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<
  TInitialPayload,
  TResult,
  Parameters<ReturnType<typeof serve<TInitialPayload, TResult>>["POST"]>
> => {
  const { POST: handler } = serve(...params);
  return {
    callback: createInvokeCallback<TInitialPayload, TResult>(telemetry),
    handler,
    workflowId: undefined,
  };
};

export const serveMany = (workflows: Parameters<typeof serveManyBase>[0]["workflows"]) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows: workflows,
      getWorkflowId(...params) {
        const components = params[0].request.url.split("/");
        return components[components.length - 1];
      },
    }).handler,
  };
};
