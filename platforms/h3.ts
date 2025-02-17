import { defineEventHandler, readRawBody } from "h3";

import type { InvokableWorkflow, PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import type { IncomingHttpHeaders } from "node:http";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback, serveManyBase } from "../src/serve/serve-many";

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
  return url
}

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "h3",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
};

export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
) => {

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

    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, telemetry, options);
    return await serveHandler(request);
  });

  return { handler };
};



export const createWorkflow = <TInitialPayload, TResult>(
  ...params: Parameters<typeof serve<TInitialPayload, TResult>>
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
  options?: Parameters<typeof serveManyBase>[0]["options"],
) => {
  return serveManyBase<ReturnType<typeof serve>["handler"]>({
    workflows: workflows,
    getWorkflowId(event) {
      const url = getUrl(event);
      const components = url.split("/");
      return components[components.length - 1];
    },
    serveMethod: (...params: Parameters<typeof serve>) => serve(...params).handler,
    options
  })
};
