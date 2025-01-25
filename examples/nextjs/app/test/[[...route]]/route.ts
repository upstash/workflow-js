import { W } from "../../../../../src/serve/router"

export type Bindings = {
    DATABASE_URL: string
    REDIS_URL: string
    REDIS_TOKEN: string
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
