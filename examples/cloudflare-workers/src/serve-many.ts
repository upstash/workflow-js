import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/cloudflare";

const workflowOne = createWorkflow(async (context) => {
  await context.run("step 1", async () => {
    console.log("workflow one says hi")
  })

  const { body, isCanceled, isFailed } = await context.invoke("invoking other", {
    workflow: workflowTwo,
    body: "hello from workflow one",
  })

  await context.run("checking invoke results", () => {
    console.log("invoke results", { body, isCanceled, isFailed })
  })

  await context.run("step 2", async () => {
    console.log("workflow one says bye")
  })
})

const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
  await context.run("step 1", async () => {
    console.log("workflow two says hi")
  })

  await context.run("step 2", async () => {
    console.log("workflow two says bye")
  })

  return "workflow two done"
}, {
  retries: 0
})

export default serveMany({
  workflowOne,
  workflowTwo
})
