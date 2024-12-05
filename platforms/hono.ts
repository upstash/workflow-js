import type { Context } from "hono";
import type { RouteFunction, WorkflowServeOptions } from "../src";
import { serve as serveBase } from "../src";
import { Variables } from "hono/types";

export type WorkflowBindings = {
  QSTASH_TOKEN: string;
  QSTASH_URL?: string;
  QSTASH_CURRENT_SIGNING_KEY?: string;
  QSTASH_NEXT_SIGNING_KEY?: string;
  UPSTASH_WORKFLOW_URL?: string;
};

/**
 * Serve method to serve a Upstash Workflow in a Nextjs project
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
>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: Omit<WorkflowServeOptions<Response, TInitialPayload>, "onStepFinish">
): ((context: Context<{ Bindings: TBindings; Variables: TVariables }>) => Promise<Response>) => {
  const handler = async (context: Context<{ Bindings: TBindings; Variables: TVariables }>) => {
    const environment = context.env;
    const request = context.req.raw;

    const { handler: serveHandler } = serveBase(routeFunction, {
      // when hono is used without cf workers, it sends a DebugHTTPServer
      // object in `context.env`. don't pass env if this is the case:
      env: "QSTASH_TOKEN" in environment ? environment : undefined,
      ...options,
    });
    return await serveHandler(request);
  };
  return handler;
};
