import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serve, serveMany } from "@upstash/workflow/nextjs";
import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, nanoid, testServe } from "app/ci/utils";
import { z } from "zod";

const testHeader = `test-header-foo`
const headerValue = `header-foo`
const payload = 123


const invokePayload = "invoke-payload"
const invokeResult = "invoke-result"

const invokeHeader = "invoke-header"
const invokeHeaderValue = "invoke-header-value"

const workflowRunIdHeader = "workflow-run-id-header"

const workflowOne = createWorkflow(async (context: WorkflowContext<number>) => {
  const workflowRunId = await context.run("step 1", async () => {
    console.log("workflow one says hi")
    return nanoid()
  })

  const { body, isCanceled, isFailed } = await context.invoke("invoking other", {
    workflow: workflowTwo,
    body: invokePayload,
    headers: {
      [invokeHeader]: invokeHeaderValue,
      [workflowRunIdHeader]: workflowRunId,
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
    workflowRunId,
  })

  expect(body, invokeResult)
  expect(isCanceled, false)
  expect(isFailed, false)

  const { body: failingBody, isCanceled: failingIsCanceled, isFailed: failingIsFailed } = await context.invoke("invoke failing", {
    workflow: workflowThree,
    body: invokePayload,
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
    retries: 0
  })

  expect(failingBody, undefined)
  expect(failingIsCanceled, false)
  expect(failingIsFailed, true)

  await context.run("step 2", async () => {
    console.log("workflow one says bye")
  })


  await saveResult(
    context,
    "done invoke"
  )
}, {
  schema: z.number()
})

const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
  expect(context.requestPayload, invokePayload)
  expect(context.headers.get(invokeHeader) as string, invokeHeaderValue)
  expect(`wfr_${context.headers.get(workflowRunIdHeader)}`, context.workflowRunId)

  await context.run("step 1", async () => {
    console.log("workflow two says hi")
  })

  await context.run("step 2", async () => {
    console.log("workflow two says bye")
  })

  return invokeResult
})

const workflowThree = createWorkflow(async (context: WorkflowContext<string>) => {
  expect(context.requestPayload, invokePayload)
  throw new Error("what")
}, {
  retries: 0
})

export const { POST, GET } = testServe(
  serveMany({
    workflowOne,
    workflowTwo,
    workflowThree
  }),
  {
    expectedCallCount: 10,
    expectedResult: "done invoke",
    payload,
    headers: {
      [testHeader]: headerValue,
    }
  }
)