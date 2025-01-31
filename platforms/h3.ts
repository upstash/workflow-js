import { defineEventHandler, readRawBody } from "h3";

import type { PublicServeOptions, RouteFunction, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import type { IncomingHttpHeaders } from "node:http";
import { SDK_TELEMETRY } from "../src/constants";
import { createInvokeCallback } from "../src/serve/serve-many";

function transformHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const formattedHeaders = Object.entries(headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(", ") : (value ?? ""),
  ]);
  return formattedHeaders as [string, string][];
}

export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
) => {
  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "h3",
    runtime: process.versions.bun
      ? `bun@${process.versions.bun}/node@${process.version}`
      : `node@${process.version}`,
  };

  const handler = defineEventHandler(async (event) => {
    const method = event.node.req.method;
    if (method?.toUpperCase() !== "POST") {
      return new Response("Only POST requests are allowed in worklfows", {
        status: 405,
      });
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

    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, telemetry, options);
    return await serveHandler(request);
  });

  const invokeWorkflow = createInvokeCallback<TInitialPayload, TResult>(
    options?.workflowId,
    telemetry
  );
  return { handler, invokeWorkflow, workflowId: options?.workflowId };
};

// export const serveMany: ServeMany<typeof serve, "handler"> = ({ routes }) => {
//   return {
//     handler: serveManyBase({
//       routes,
//       getHeader(header, params) {
//         const [request] = params;
//         return request.headers.get(header);
//       },
//     }).handler,
//   };
// };
