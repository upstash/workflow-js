import type { PublicServeOptions, Telemetry, InvokableWorkflow } from "../src";
import type { RouteMethodHandlerCtx } from "@tanstack/react-start";
import type { AnyRoute } from "@tanstack/router-core";
import { WorkflowContext } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "tanstack",
  runtime: `node@${process.version}`,
};

type TanStackRouteHandlerCtx<
  TRegister = unknown,
  TParentRoute extends AnyRoute = AnyRoute,
  TFullPath extends string = string,
  TServerMiddlewares = unknown,
  TMethodMiddlewares = unknown,
> = RouteMethodHandlerCtx<
  TRegister,
  TParentRoute,
  TFullPath,
  TServerMiddlewares,
  TMethodMiddlewares
>;

/**
 * Serve method to serve a Upstash Workflow in a TanStack Start project
 *
 * This wrapper allows you to access both the workflow context and TanStack route context
 *
 * @param routeFunction workflow function that receives both workflow context and TanStack route context
 * @param options workflow options (same as Next.js serve options)
 * @returns handler object with POST method compatible with TanStack Start
 */
export function serve<
  TInitialPayload = unknown,
  TResult = unknown,
  TRegister = unknown,
  TParentRoute extends AnyRoute = AnyRoute,
  TFullPath extends string = string,
  TServerMiddlewares = unknown,
  TMethodMiddlewares = unknown,
>(
  routeFunction: (
    workflowContext: WorkflowContext<TInitialPayload>,
    tanstackContext: TanStackRouteHandlerCtx<
      TRegister,
      TParentRoute,
      TFullPath,
      TServerMiddlewares,
      TMethodMiddlewares
    >
  ) => Promise<TResult>,
  options?: PublicServeOptions<TInitialPayload>
) {
  const POST = (
    tanstackContext: TanStackRouteHandlerCtx<
      TRegister,
      TParentRoute,
      TFullPath,
      TServerMiddlewares,
      TMethodMiddlewares
    >
  ) => {
    // Create a Next.js compatible handler that passes the route context
    const { handler } = serveBase<TInitialPayload, Request, Response, TResult>(
      (workflowContext) => routeFunction(workflowContext, tanstackContext),
      telemetry,
      options
    )

    return handler(tanstackContext.request)
  }

  return { POST }
}

export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    options,
    workflowId: undefined,
    // @ts-expect-error because tanstack route function has another parameter,
    // the RouteFunction type can't cover this. We need to make RouteFunction
    // accept more variables than simply the context. Until then, ignoring the
    // error here. Tested the usage in tanstack project and it's fine. TODO.
    // Astro has a similar issue, see astro.ts for more details.
    routeFunction,
  };
};

/**
 * Serve multiple workflows from a single endpoint using dynamic routing in TanStack Start
 *
 * @param workflows object containing workflow definitions
 * @param options serve options
 * @returns handler object with POST method
 */
export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows,
      getUrl(context) {
        return context.request.url;
      },
      serveMethod: (...params: Parameters<typeof serve>) => serve(...params).POST,
      options,
    }).handler,
  };
};
