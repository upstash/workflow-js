import type { WorkflowServeOptions, RouteFunction } from "../src";
import { serve as serveBase } from "../src";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  Router,
  RequestHandler,
} from "express";

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

    // only allow application/json content type
    if (request_.headers["content-type"] !== "application/json") {
      res.status(400).json("Only application/json content type is allowed in express workflows");
      return;
    }

    // create Request
    const protocol = request_.protocol;
    const host = request_.get("host") || "localhost";
    const url = `${protocol}://${host}${request_.originalUrl}`;

    const webRequest = new Request(url, {
      method: request_.method,
      headers: new Headers(request_.headers as Record<string, string>),
      body: JSON.stringify(request_.body),
    });

    // create handler
    const { handler: serveHandler } = serveBase<TInitialPayload>(
      (workflowContext) => routeFunction(workflowContext),
      options
    );

    const response = await serveHandler(webRequest);

    res.status(response.status).json(await response.json());
  };

  router.all("*", handler);

  return router;
}
