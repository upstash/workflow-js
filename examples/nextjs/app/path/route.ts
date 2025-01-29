import { serveMany, WorkflowContext } from '@upstash/workflow'
import { serve } from '@upstash/workflow/nextjs'
import { z } from 'zod'

const routeOne = serve(async (context: WorkflowContext<string>) => {
  // console.log("one", context.workflowRunId, context.headers, context.steps);
  
  const input = context.requestPayload

  await context.run("asd", () => console.log("route one says hi"))

  console.log("one ends?");
  return 123 as const
  
}, {
  workflowId: "my-id"
})

const routeTwo = serve<string>(async (context) => {
  // console.log("two", context.workflowRunId, context.steps);
  await context.run("asd", () => console.log("route two says hi"))

  const { body } = await context.invoke("invoking", {
    invokeFunction: routeOne.workflow,
    body: "23"
  })
  console.log(body);
  await context.run("asd", () => console.log("route two says bye"))
  console.log("two ends?");

})

export const { POST } = serveMany([
  routeOne,
  routeTwo
])