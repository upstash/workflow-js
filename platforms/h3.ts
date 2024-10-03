import { defineEventHandler, readRawBody } from "h3";

import type { RouteFunction, WorkflowServeOptions } from "../src/workflow";
import { serve as serveBase } from "../src/workflow";
import type { IncomingHttpHeaders } from "node:http";

function transformHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const formattedHeaders = Object.entries(headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(", ") : (value ?? ""),
  ]);
  return formattedHeaders as [string, string][];
}

export const serve = <TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: Omit<WorkflowServeOptions<Response, TInitialPayload>, "onStepFinish">
) => {
  const handler = defineEventHandler(async (event) => {
    const method = event.node.req.method;
    if (method?.toUpperCase() !== "POST") {
      return {
        status: 405,
        body: "Only POST requests are allowed in worklfows",
      };
    }

    const request_ = event.node.req;
    const protocol = request_.headers["x-forwarded-proto"];
    const host = request_.headers.host;
    const url = `${protocol}://${host}${event.path}`;
    const headers = transformHeaders(request_.headers);

    const request = new Request(url, {
      headers: headers,
      body: await readRawBody(event),
      method: "POST",
    });

    const serveHandler = serveBase<TInitialPayload>(routeFunction, options);
    return await serveHandler(request);
  });
  return handler;
};
