import { type WorkflowServeOptions, type RouteFunction } from "../src";
import { SDK_TELEMETRY } from "../src/constants";
import { serveBase } from "../src/serve";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  Router,
  RequestHandler,
} from "express";

const isEmptyRequest = (req: ExpressRequest) => {
  return req.headers["content-type"] === "application/json" && req.headers["content-length"] === "0"
}

export function serve<TInitialPayload = unknown>(
  routeFunction: RouteFunction<TInitialPayload>,
  options?: Omit<WorkflowServeOptions<globalThis.Response, TInitialPayload>, "onStepFinish">
): Router {
  const router = Router();

  const handler: RequestHandler = async (request_: ExpressRequest, res: ExpressResponse) => {
    // only allow POST requests
    if (request_.method.toUpperCase() !== "POST") {
      res.status(405).json("Only POST requests are allowed in workflows");
      return;
    }

    let requestBody: string;
    if (isEmptyRequest(request_)) {
      requestBody = ""
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
    const { handler: serveHandler } = serveBase<TInitialPayload>(
      routeFunction,
      {
        sdk: SDK_TELEMETRY,
        framework: "express",
        runtime: process.versions.bun
          ? `bun@${process.versions.bun}/node@${process.version}`
          : `node@${process.version}`,
      },
      {
        ...options,
        useJSONContent: true,
      }
    );

    const response = await serveHandler(webRequest);

    res.status(response.status).json(await response.json());
  };

  router.all("*", handler);

  return router;
}
