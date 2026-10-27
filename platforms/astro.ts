import type { APIContext, APIRoute } from "astro";

import { InvokableWorkflow, WorkflowServeOptions, Telemetry, WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";
import { startDevServer } from "@upstash/qstash";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "astro",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
};

/**
 * Code outside steps runs again on every request of the run. Anything it branches on or
 * returns early on (Date.now(), database rows, random values) must give the same answer on
 * every request, or later requests fail with "Incompatible step name" or "Failed to
 * authenticate Workflow request". Read such values inside `context.run` and branch on its
 * result.
 *
 * @see node_modules/@upstash/workflow/docs/basics/serve.mdx
 * @see node_modules/@upstash/workflow/docs/quickstarts/astro.mdx
 */
export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: (
    workflowContext: WorkflowContext<TInitialPayload>,
    apiContext: APIContext
  ) => Promise<TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
) {
  void startDevServer();

  const POST: APIRoute = (apiContext) => {
    const { handler } = serveBase<TInitialPayload, Request, Response, TResult>(
      (workflowContext) => routeFunction(workflowContext, apiContext),
      telemetry,
      options
    );

    return handler(apiContext.request);
  };

  return { POST };
}

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke.mdx
 */
export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    workflowId: undefined,
    // @ts-expect-error because astro route function has another parameter,
    // the RouteFunction type can't cover this. We need to make RouteFunction
    // accept more variables than simply the context. Until then, ignoring the
    // error here. Tested the usage in astro project and it's fine. TODO.
    routeFunction,
    options,
  };
};

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke/serveMany.mdx
 */
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
