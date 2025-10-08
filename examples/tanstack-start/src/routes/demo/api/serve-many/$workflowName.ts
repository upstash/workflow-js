// src/routes/demo/api/serve-many/$workflowName.ts
import { createFileRoute } from '@tanstack/react-router'
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs"
import type { WorkflowContext } from "@upstash/workflow"

const workflowOne = createWorkflow(async (context) => {
  await context.run("step 1", () => {
    console.log("workflow one says hi")
  })

  const { body, isCanceled, isFailed } = await context.invoke("invoking other", {
    workflow: workflowTwo,
    body: "hello from workflow one",
  })

  await context.run("checking invoke results", () => {
    console.log("invoke results", { body, isCanceled, isFailed })
  })

  await context.run("step 2", () => {
    console.log("workflow one says bye")
  })
})

const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
  await context.run("step 1", () => {
    console.log("workflow two says hi")
  })

  await context.run("step 2", () => {
    console.log("workflow two says bye")
  })

  return "workflow two done"
}, {
  retries: 0
})

const { POST: serveManyHandler } = serveMany({
  workflowOne,
  workflowTwo,
})

export const Route = createFileRoute('/demo/api/serve-many/$workflowName')({
  server: {
    handlers: {
      POST: async (ctx) => {
        return serveManyHandler(ctx.request)
      },
    },
  },
})
