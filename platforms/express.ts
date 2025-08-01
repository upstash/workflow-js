import type { WorkflowServeOptions, RouteFunction, Telemetry, InvokableWorkflow } from "../src";
import { SDK_TELEMETRY } from "../src/constants";
import { serveBase } from "../src/serve";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  Router,
  RequestHandler,
} from "express";
import { serveManyBase } from "../src/serve/serve-many";

const isEmptyRequest = (req: ExpressRequest) => {
  return (
    req.headers["content-type"] === "application/json" && req.headers["content-length"] === "0"
  );
};

const telemetry: Telemetry = {
  sdk: SDK_TELEMETRY,
  framework: "express",
  runtime: process.versions.bun
    ? `bun@${process.versions.bun}/node@${process.version}`
    : `node@${process.version}`,
};

function createExpressHandler<TInitialPayload = unknown, TResult = unknown>(
  params: Parameters<typeof serve<TInitialPayload, TResult>>
): RequestHandler {
  const [routeFunction, options] = params;
  return async (request_: ExpressRequest, res: ExpressResponse) => {
    // only allow POST requests
    if (request_.method.toUpperCase() !== "POST") {
      res.status(405).json("Only POST requests are allowed in workflows");
      return;
    }

    let requestBody: string;
    if (isEmptyRequest(request_)) {
      requestBody = "";
    } else if (request_.headers["content-type"]?.includes("text/plain")) {
      requestBody = request_.body;
    } else if (request_.headers["content-type"]?.includes("application/json")) {
      requestBody = JSON.stringify(request_.body);
    } else {
      requestBody =
        typeof request_.body === "string" ? request_.body : JSON.stringify(request_.body);
    }

    // create Request
    const protocol = request_.protocol;
    const host = request_.get("host") || "localhost";
    const url = `${protocol}://${host}${request_.originalUrl}`;

    const webRequest = new Request(url, {
      method: request_.method,
      headers: new Headers(request_.headers as Record<string, string>),
      body: requestBody,
    });

    // create handler
    const { handler: serveHandler } = serveBase<TInitialPayload>(routeFunction, telemetry, {
      ...options,
      useJSONContent: true,
    });

    const response = await serveHandler(webRequest);

    res.status(response.status).json(await response.json());

    // set headers
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }
  };
}

export function serve<TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: Omit<WorkflowServeOptions<globalThis.Response, TInitialPayload>, "onStepFinish">
): Router {
  const router = Router();

  const handler: RequestHandler = createExpressHandler([routeFunction, options]);

  router.all("*", handler);

  return router;
}

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
  const router = Router();

  const { handler } = serveManyBase<ReturnType<typeof createExpressHandler>>({
    workflows: workflows,
    getUrl(...params) {
      return params[0].url;
    },
    serveMethod: (...params: Parameters<typeof serve>) => createExpressHandler(params),
    options,
  });

  router.all("*", handler);
  return router;
};
