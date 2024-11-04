
import type { WorkflowServeOptions, RouteFunction } from "../src";
import { serve as serveBase } from "../src";
import { Request as ExpressRequest, Response as ExpressResponse, Router, RequestHandler } from "express";


export function serve<TInitialPayload = unknown>(
	routeFunction: RouteFunction<TInitialPayload>,
	options?: Omit<WorkflowServeOptions<globalThis.Response, TInitialPayload>, "onStepFinish">
): Router {
	const router = Router();

	const handler: RequestHandler = async (request_: ExpressRequest, res: ExpressResponse) => {

		const { handler: serveHandler } = serveBase<TInitialPayload>(
			(workflowContext) => routeFunction(workflowContext),
			options
		);

		const protocol = request_.protocol;
		const host = request_.get('host') || 'localhost';
		const url = `${protocol}://${host}${request_.originalUrl}`;

		const webRequest = new Request(url, {
			method: request_.method,
			headers: new Headers(request_.headers as Record<string, string>),
			body: request_.method !== 'GET' && request_.method !== 'HEAD'
				? JSON.stringify(request_.body)
				: undefined
		});

		const response = await serveHandler(webRequest);

		res.status(response.status).json(await response.json());

	};

	router.all('*', handler);

	return router;
}