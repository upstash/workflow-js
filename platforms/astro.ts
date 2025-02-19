import type { APIContext, APIRoute } from "astro";

import { InvokableWorkflow, PublicServeOptions, Telemetry, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";

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
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    workflowId: undefined,
    // @ts-expect-error because astro route function has another parameeter,
    // the RouteFunction type can't cover this. We need to make RouteFunction
    // accept more variables than simply the context. Until then, ignoring the
    // error here. Tested the usage in astro project and it's fine. TODO.
    routeFunction,
    options,
  };
};

export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows: workflows,
      getUrl(...params) {
        return params[0].request.url;
      },
      serveMethod: (...params: Parameters<typeof serve>) => serve(...params).POST,
      options,
    }).handler,
  };
};
