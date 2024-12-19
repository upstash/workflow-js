/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import type { RouteFunction, PublicServeOptions } from "../src";
import { serveBase } from "../src/serve";

/**
 * Serve method to serve a Upstash Workflow in a Nextjs project
 *
 * See for options https://upstash.com/docs/qstash/workflows/basics/serve
 *
 * @param routeFunction workflow function
 * @param options workflow options
 * @returns
 */
export const serve = <TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: PublicServeOptions<TInitialPayload>
): { POST: (request: Request) => Promise<Response> } => {
  const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response>(
    routeFunction,
    options
  );

  return {
    POST: async (request: Request) => {
      return await serveHandler(request);
    },
  };
};

export const servePagesRouter = <TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: PublicServeOptions<TInitialPayload>
): { handler: NextApiHandler } => {
  const { handler: serveHandler } = serveBase(routeFunction, options);

  const handler = async (request_: NextApiRequest, res: NextApiResponse) => {
    if (request_.method?.toUpperCase() !== "POST") {
      res.status(405).json("Only POST requests are allowed in worklfows");
      return;
    } else if (!request_.url) {
      res.status(400).json("url not found in the request");
      return;
    }

    const protocol = request_.headers["x-forwarded-proto"];
    const baseUrl = options?.baseUrl ?? `${protocol}://${request_.headers.host}`;

    const request = new Request(options?.url ?? `${baseUrl}${request_.url}`, {
      body:
        (typeof request_.body === "string"
          ? request_.body
          : typeof request_.body === "undefined"
            ? undefined
            : JSON.stringify(request_.body)) ?? "",
      headers: new Headers(request_.headersDistinct as Record<string, string[]>),
      method: "POST",
    });
    const response = await serveHandler(request);
    res.status(response.status).json(await response.json());
  };

  return { handler };
};
