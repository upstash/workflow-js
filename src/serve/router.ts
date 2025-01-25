
import { Env, Hono } from "hono";
import { serve } from "../../platforms/nextjs"
import { WorkflowContext } from "../context";


export type Bindings = {
	DATABASE_URL: string
	REDIS_URL: string
	REDIS_TOKEN: string
}

type RouterParams = {
	baseUrl?: string
	basePath?: string
}

export class W {
	baseUrl?: string
	basePath?: string
	constructor(params?: RouterParams) {
		const { baseUrl, basePath } = params || {}
		this.baseUrl = baseUrl
		this.basePath = basePath
	}

	router = <T extends Record<string, { payload: unknown; output: unknown }>>(routes: {
		[K in keyof T]: (context: WorkflowContext<T[K]['payload'], T>) => Promise<T[K]['output']>
	}) => {
		const base = new Hono()
		const route = new Hono()

		Object.entries(routes).forEach(([key, routeFunc]) => {
			const path = `/${key}` as const
			route.post(path, async (c) => {
				const handler = serve(routeFunc, {
					baseUrl: this.baseUrl,
					router: route as Hono<Env, T>
				})
				return await handler.POST(c.req.raw)
			})
		})

		if (this.basePath) {
			base.route(this.basePath, route)
		}

		const invokeWorkflow = async <K extends keyof T & string>({
			function: fn,
			payload
		}: {
			function: K
			payload?: T[K]["payload"]
		}): Promise<T[K]["output"]> => {
			const funcURL = this.basePath ? `${this.basePath}/${fn}` : fn
			const res = await fetch(`${this.baseUrl}/${funcURL}`, {
				method: 'POST',
				body: JSON.stringify(payload)
			})
			return res.json()
		}

		return {
			invokeWorkflow,
			route: this.basePath ? base : route
		}
	}
}