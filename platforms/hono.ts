import type { Context } from "hono";
import type { InvokableWorkflow, PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { Variables } from "hono/types";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback, serveManyBase } from "../src/serve/serve-many";

export type WorkflowBindings = {
  QSTASH_TOKEN: string;
  QSTASH_URL?: string;
  QSTASH_CURRENT_SIGNING_KEY?: string;
  QSTASH_NEXT_SIGNING_KEY?: string;
  UPSTASH_WORKFLOW_URL?: string;
};

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "hono",
};

/**
 * Serve method to serve a Upstash Workflow in a Hono project
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 */
export const serve = <
  TInitialPayload = unknown,
  TBindings extends WorkflowBindings = WorkflowBindings,
  TVariables extends Variables = Variables,
  TResult = unknown,
>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
): ((context: Context<{ Bindings: TBindings; Variables: TVariables }>) => Promise<Response>) => {
  const handler = async (context: Context<{ Bindings: TBindings; Variables: TVariables }>) => {
    const environment = context.env;
    const request = context.req.raw;

    const { handler: serveHandler } = serveBase(routeFunction, telemetry, {
      // when hono is used without cf workers, it sends a DebugHTTPServer
      // object in `context.env`. don't pass env if this is the case:
      env: "QSTASH_TOKEN" in environment ? environment : undefined,
      ...options,
    });
    return await serveHandler(request);
  };
  return handler;
};

export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, WorkflowBindings, Variables, TResult>>
): InvokableWorkflow<
  TInitialPayload,
  TResult
> => {
  const [routeFunction, options = {}] = params;
  return {
    callback: createInvokeCallback<TInitialPayload, TResult>(telemetry),
    routeFunction,
    options,
    workflowId: undefined,
  };
};

export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return serveManyBase<ReturnType<typeof serve>>({
    workflows: workflows,
    getWorkflowId(params) {
      const components = params.req.url.split("/");
      return components[components.length - 1];
    },
    serveMethod: (...params: Parameters<typeof serve>) => serve(...params),
    options
  }).handler;
};
