import type { PublicServeOptions, RouteFunction, ServeMany, Telemetry } from "../src";
import { SDK_TELEMETRY } from "../src/constants";
import { serveBase } from "../src/serve";
import { createInvokeCallback, serveManyBase } from "../src/serve/serve-many";

export type WorkflowBindings = {
  QSTASH_TOKEN: string;
  QSTASH_URL?: string;
  QSTASH_CURRENT_SIGNING_KEY?: string;
  QSTASH_NEXT_SIGNING_KEY?: string;
  UPSTASH_WORKFLOW_URL?: string;
};

/**
 * Cloudflare Pages Function arguments
 */
export type PagesHandlerArgs = [{ request: Request; env: Record<string, string | undefined> }];

/**
 * Cloudflare Worker arguments
 */
export type WorkersHandlerArgs = [Request, Record<string, string | undefined>];

/**
 * Support both Cloudflare Pages Functions and Cloudflare Workers
 */
const getArgs = (
  args: PagesHandlerArgs | WorkersHandlerArgs
): { request: Request; env: Record<string, string | undefined> } => {
  // @ts-expect-error types of args don't allow length 0, but want to sanity check
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("No arguments passed to serve handler");
  }

  if (typeof args[0] === "object" && "request" in args[0] && "env" in args[0]) {
    return {
      request: args[0].request,
      env: args[0].env,
    };
  }

  if (args.length > 1 && typeof args[1] === "object") {
    return {
      request: args[0],
      env: args[1],
    };
  }

  throw new Error("Could not derive handler arguments from input. Please check how serve is used.");
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
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, unknown>,
  options?: PublicServeOptions<TInitialPayload>
): {
  fetch: (...args: PagesHandlerArgs | WorkersHandlerArgs) => Promise<Response>,
  invokeWorkflow: ReturnType<typeof createInvokeCallback<TInitialPayload, TResult>>,
  workflowId: string | undefined
} => {
  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "cloudflare",
  }
  const fetch = async (...args: PagesHandlerArgs | WorkersHandlerArgs) => {
    const { request, env } = getArgs(args);
    const { handler: serveHandler } = serveBase(
      routeFunction,
      telemetry,
      {
        env,
        ...options,
      }
    );
    return await serveHandler(request);
  };

  const invokeWorkflow = createInvokeCallback<TInitialPayload, TResult>(options?.workflowId, telemetry)
  return { fetch, invokeWorkflow, workflowId: options?.workflowId };
};

export const serveMany: ServeMany<typeof serve, "fetch"> = ({ routes }) => {
  return {
    fetch: serveManyBase<PagesHandlerArgs | WorkersHandlerArgs>({
      routes: routes.map(route => {
        return {
          ...route,
          handler: route.fetch
        }
      }),
      getHeader(header, params) {
        const request: Request = params[0] instanceof Request ? params[0] : params[0].request
        return request.headers.get(header)
      },
    }).handler
  }
}