import { WorkflowContext } from '@upstash/workflow'
import { serve, serveMany } from '@upstash/workflow/nextjs'

const workflowOne = serve(async (context: WorkflowContext<string>) => {
  await context.run("asd", () => console.log("route one says hi"))
  await context.sleep("sleeing", 5)
  console.log("route one says bye")
  return 123 as const
}, {
  workflowId: "my-id"
})

const workflowTwo = serve<string>(async (context) => {
  await context.run("asd", () => console.log("route two says hi"))
  const { body } = await context.invoke("invoking", {
    workflow: workflowOne,
    body: "23"
  })
  await context.run("asd", () => console.log("route two says bye"))

})

export const { POST } = serveMany({
  routes: [
    workflowOne,
    workflowTwo
  ]
})