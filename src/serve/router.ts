
import { Hono } from "hono";
import { serve } from "../../platforms/nextjs"
import { WorkflowContext } from "../context";


export type Bindings = {
	DATABASE_URL: string
	REDIS_URL: string
	REDIS_TOKEN: string
}

class W {
	constructor() { }

	router = <T extends Record<string, { input: unknown; output: unknown }>>(routes: {
		[K in keyof T]: (context: WorkflowContext<T[K]['input']>) => Promise<T[K]['output']>
	}) => {
		const route = new Hono();
		Object.entries(routes).forEach(([key, routeFunc]) => {
			const path = `/${key}` as const;

			route.post(path, async (c) => {
				const handler = serve(routeFunc)
				return await handler.POST(c.req.raw)
			})
		})

		const invokeWorkflow = async <K extends keyof T & string>({
			function: fn,
			input
		}: {
			function: K
			input?: T[K]["input"]
		}): Promise<T[K]["output"]> => {
			const res = await fetch(`/${fn}`, {
				method: 'POST',
				body: JSON.stringify(input)
			})
			return res.json()
		}


		return {
			invokeWorkflow
		}
	}
}


const w = new W()
const { invokeWorkflow } = w.router<{
	workflow1: {
		input: { key: string }
		output: { value: string }
	},
	workflow2: {
		input: { key: string }
		output: { value: string }
	}
}>({
	workflow1: async (context) => {
		return await context.run("WORKFLOW1", async () => {
			console.log("WORKFLOW 1")
			return { value: "WORKFLOW 1 RUN" }
		})
	},
	workflow2: async (context) => {
		return await context.run("WORKFLOW2", async () => {
			console.log("WORKFLOW 2")
			return { value: "WORKFLOW 2 RUN" }
		})
	}
})




await invokeWorkflow({
	function: "workflow1",
	input: {
		"key": "value"
	}
})
