import { WorkflowContext } from '@upstash/workflow'
import { serve, serveMany } from '@upstash/workflow/nextjs'

const workflowOne = serve(async (context: WorkflowContext<string>) => {
  await context.run("asd", () => console.log("route one says hi"))
  await context.sleep("sleeing", 5)
  console.log("route one says bye")
  return 123 as const
})

const workflowTwo = serve<string>(async (context) => {
  await context.run("asd", () => console.log("route two says hi"))
  const { body } = await context.invoke("invoking", {
    workflow: workflowOne,
    body: "23"
  })
  await context.run("asd", () => console.log("route two says bye"))

})

const { POST: manyPost } = serveMany({
  routes: {
    workflowOne
  },
  defaultRoute: workflowTwo
})

export const POST = async (req: Request) => {
  const what = await manyPost(req)
  return what
}