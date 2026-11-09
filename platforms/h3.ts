import { defineEventHandler, readRawBody } from "h3";

import type { InvokableWorkflow, WorkflowServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import type { IncomingHttpHeaders } from "node:http";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";
import { startDevServer } from "@upstash/qstash";

function transformHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const formattedHeaders = Object.entries(headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(", ") : (value ?? ""),
  ]);
  return formattedHeaders as [string, string][];
}

function getUrl(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) {
  const request_ = event.node.req;
  const protocol = request_.headers["x-forwarded-proto"];
  const host = request_.headers.host;
  const url = `${protocol}://${host}${event.path}`;
  return url;
}

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "h3",
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
 * @see node_modules/@upstash/workflow/docs/quickstarts/nuxt.mdx
 */
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
) => {
  void startDevServer();

  const handler = defineEventHandler(async (event) => {
    const method = event.node.req.method;
    if (method?.toUpperCase() !== "POST") {
      return new Response("Only POST requests are allowed in worklfows", {
        status: 405,
      });
    }

    const url = getUrl(event);
    const headers = transformHeaders(event.node.req.headers);

    const request = new Request(url, {
      headers: headers,
      body: await readRawBody(event),
      method: "POST",
    });

    const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response, TResult>(
      routeFunction,
      telemetry,
      options
    );
    return await serveHandler(request);
  });

  return { handler };
};

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke.mdx
 */
export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    routeFunction,
    options,
    workflowId: undefined,
  };
};

/**
 * @see node_modules/@upstash/workflow/docs/features/invoke/serveMany.mdx
 */
export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return serveManyBase<ReturnType<typeof serve>["handler"]>({
    workflows: workflows,
    getUrl,
    serveMethod: (...params: Parameters<typeof serve>) => serve(...params).handler,
    options,
  });
};
