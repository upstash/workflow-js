
import type { WorkflowServeOptions, RouteFunction } from "../src";
import { serve as serveBase } from "../src";
import { Request, Response, Router, RequestHandler } from "express";

// export function serve<TInitialPayload = unknown>(
// 	routeFunction: RouteFunction<TInitialPayload>,
// 	options?: Omit<WorkflowServeOptions<Response, TInitialPayload>, "onStepFinish">
// ) {
// 	const handler = async (request: Request) => {
// 		const { handler: serveHandler } = serveBase<TInitialPayload>(
// 			(workflowContext) => routeFunction(workflowContext),
// 			options
// 		);

// 		return await serveHandler(request);
// 	}

// 	return { handler };
// }
export function serve<TInitialPayload = unknown>(
	routeFunction: RouteFunction<TInitialPayload>,
	options?: Omit<WorkflowServeOptions<Response, TInitialPayload>, "onStepFinish">
): Router {
	const router = Router();

	const middlewareHandler: RequestHandler = async (req: Request, res: Response) => {
		try {
			const { handler: serveHandler } = serveBase<TInitialPayload>(
				(workflowContext) => routeFunction(workflowContext),
				options
			);


			const webRequest = new Request(req.url, {
				method: req.method,
				headers: new Headers(req.headers as Record<string, string>),
				body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
			});


			const response = await serveHandler(webRequest);


			res.status(response.status);
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});

			const responseData = await response.json().catch(() => response.text());
			res.send(responseData);
		} catch (error) {
			console.error('Workflow error:', error);
			res.status(500).json({ error: 'Internal Server Error' });
		}
	};

	// Handle all HTTP methods
	router.all('*', middlewareHandler);

	return router;
}