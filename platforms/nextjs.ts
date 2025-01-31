/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import type { RouteFunction, PublicServeOptions, ServeMany, Telemetry } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";

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
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
) => {
  const {
    handler: serveHandler,
    workflowId,
    telemetry,
  } = serveBase<TInitialPayload, Request, Response, TResult>(
    routeFunction,
    {
      sdk: SDK_TELEMETRY,
      framework: "nextjs",
      runtime: `node@${process.version}`,
    },
    options
  );

  return {
    POST: async (request: Request) => {
      return await serveHandler(request);
    },
    telemetry,
    workflowId,
  };
};

export const servePagesRouter = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
): {
  handler: NextApiHandler;
  workflowId: string | undefined;
  telemetry?: Telemetry;
} => {
  const telemetry: Telemetry = {
    sdk: SDK_TELEMETRY,
    framework: "nextjs-pages",
    runtime: process.versions.bun
      ? `bun@${process.versions.bun}/node@${process.version}`
      : `node@${process.version}`,
  };
  const { handler: serveHandler } = serveBase(routeFunction, telemetry, options);

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

  return {
    handler,
    telemetry,
    workflowId: options?.workflowId,
  };
};

export const serveMany: ServeMany<typeof serve, "POST"> = ({ routes, defaultRoute }) => {
  const newRoutes = Object.fromEntries(
    Object.entries(routes).map((route) => {
      return [route[0], { ...route[1], handler: route[1].POST }];
    })
  );
  const res = {
    POST: serveManyBase<[Request]>({
      routes: newRoutes,
      getHeader(header, params) {
        const [request] = params;
        return request.headers.get(header);
      },
      defaultRoute: { ...defaultRoute, handler: defaultRoute.POST },
    }).handler,
  };

  for (const route in routes) {
    routes[route].workflowId = newRoutes[route].workflowId;
  }

  return res;
};
