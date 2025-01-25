
import { Env, Hono } from "hono";
import { serve } from "../../../../../platforms/nextjs"
import { WorkflowContext } from "../../../../../src/context";


export type Bindings = {
    DATABASE_URL: string
    REDIS_URL: string
    REDIS_TOKEN: string
}

type RouterParams = {
    baseUrl?: string
    basePath?: string
}

class W {
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


const w = new W({
    baseUrl: "https://5c4c-85-101-27-246.ngrok-free.app",
    basePath: "/test"
})

export const { invokeWorkflow, route } = w.router<{
    workflow1: {
        payload: { key: string }
        output: { value: string }
    },
    workflow2: {
        payload: { key: number }
        output: { value: number }
    }
}>({
    workflow1: async (context) => {
        const res = await context.invoke({
            function: "workflow2",
            payload: {
                key: 3
            }
        })
        return await context.run("WORKFLOW1", async () => {
            console.log("WORKFLOW 1")
            return { value: "WORKFLOW 1 RUN" }
        })
    },
    workflow2: async (context) => {
        return await context.run("WORKFLOW2", async () => {
            console.log("WORKFLOW 2")
            return { value: 2 }
        })
    }
})

export const POST = route.fetch
