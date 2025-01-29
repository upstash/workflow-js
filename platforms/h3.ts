import { defineEventHandler, readRawBody } from "h3";

import type { PublicServeOptions, RouteFunction } from "../src";
import { serveBase } from "../src/serve";
import type { IncomingHttpHeaders } from "node:http";
import { SDK_TELEMETRY } from "../src/constants";

function transformHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const formattedHeaders = Object.entries(headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(", ") : (value ?? ""),
  ]);
  return formattedHeaders as [string, string][];
}

export const serve = <TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload, unknown>,
  options?: PublicServeOptions<TInitialPayload>
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

    const { handler: serveHandler } = serveBase<TInitialPayload>(
      routeFunction,
      {
        sdk: SDK_TELEMETRY,
        framework: "h3",
        runtime: process.versions.bun
          ? `bun@${process.versions.bun}/node@${process.version}`
          : `node@${process.version}`,
      },
      options
    );
    return await serveHandler(request);
  });

  return { handler };
};
