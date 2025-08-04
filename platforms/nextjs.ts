/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import type { RouteFunction, PublicServeOptions, Telemetry, InvokableWorkflow } from "../src";
import { serveBase } from "../src/serve";
import { SDK_TELEMETRY } from "../src/constants";
import { serveManyBase } from "../src/serve/serve-many";

const appTelemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "nextjs",
  runtime: `node@${process.version}`,
};

const pagesTelemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "nextjs-pages",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
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
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
) => {
  const { handler: serveHandler } = serveBase<TInitialPayload, Request, Response, TResult>(
    routeFunction,
    appTelemetry,
    options
  );

  return {
    POST: async (request: Request) => {
      return await serveHandler(request);
    },
  };
};

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

export const serveMany = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return {
    POST: serveManyBase<ReturnType<typeof serve>["POST"]>({
      workflows: workflows,
      getUrl(params) {
        return params.url;
      },
      serveMethod: (...params: Parameters<typeof serve>) => serve(...params).POST,
      options,
    }).handler,
  };
};

export const servePagesRouter = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: PublicServeOptions<TInitialPayload>
): {
  handler: NextApiHandler;
} => {
  const { handler: serveHandler } = serveBase(routeFunction, pagesTelemetry, options);

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

    // set headers
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    res.status(response.status).json(await response.json());
  };

  return {
    handler,
  };
};

export const createWorkflowPagesRouter = <TInitialPayload, TResult>(
  ...params: Parameters<typeof servePagesRouter<TInitialPayload, TResult>>
): InvokableWorkflow<TInitialPayload, TResult> => {
  const [routeFunction, options = {}] = params;
  return {
    routeFunction,
    options,
    workflowId: undefined,
  };
};

export const serveManyPagesRouter = (
  workflows: Parameters<typeof serveManyBase>[0]["workflows"],
  options?: Parameters<typeof serveManyBase>[0]["options"]
) => {
  return serveManyBase<ReturnType<typeof servePagesRouter>["handler"]>({
    workflows: workflows,
    getUrl(request_) {
      const protocol = request_.headers["x-forwarded-proto"];
      const host = request_.headers.host;
      const baseUrl = `${protocol}://${host}`;

      return `${baseUrl}${request_.url}`;
    },
    serveMethod: (...params: Parameters<typeof servePagesRouter>) =>
      servePagesRouter(...params).handler,
    options,
  });
};
