import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER, TEST_ROUTE_PREFIX } from "app/ci/constants";
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

  // @ts-expect-error accessing private fields for testing purposes.
  // We also check after the first step, because DisabledWorkflowContext
  // doesn't have the correct invokeCount
  const invokeCount = context.executor.invokeCount
  expect(invokeCount, 1)

  await context.run("step 2", async () => {
    console.log("workflow two says bye")
  })

  const result = await Promise.all([
    context.invoke("invoke branch one", {
      workflow: branchOne,
      body: 1,
      headers: {
        [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
        [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
      }
    }),
    context.invoke("invoke branch two", {
      workflow: branchTwo,
      body: 2,
      headers: {
        [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
        [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
      }
    })
  ])

  expect(result[0].body, "branch-one-result")
  expect(result[1].body, "branch-two-result")

  return invokeResult
})

const workflowThree = createWorkflow(async (context: WorkflowContext<string>) => {
  expect(context.requestPayload, invokePayload)
  throw new Error("what")
}, {
  retries: 0
})

/**
 * wait for event workflows
 */

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/invoke/called-endpoint`
const notifiedEventId = "notifiedEvent"

/**
 * calls waitForEvent and checks invokeCount
 */
const branchOne = createWorkflow(async (context: WorkflowContext<number>) => {
  const { timeout } = await context.waitForEvent("timeoutEvent", "timeoutEvent", { timeout: 1 })
  expect(timeout, true)

  // @ts-expect-error accessing private fields for testing purposes.
  // We also check after the first step, because DisabledWorkflowContext
  // doesn't have the correct invokeCount
  const invokeCount = context.executor.invokeCount
  expect(invokeCount, 2)

  const { timeout: isTimeout } = await context.waitForEvent("notified event", notifiedEventId, { timeout: "10s" })
  expect(isTimeout, false)

  await context.sleep("check", 1)

  return "branch-one-result"
})

/**
 * notifies branhcOne, calls context.call and checks invokeCount
 */
const branchTwo = createWorkflow(async (context: WorkflowContext<number>) => {

  const { status } = await context.call("call", {
    url: thirdPartyEndpoint,
    method: "GET",
  })

  expect(status, 200)

  // @ts-expect-error accessing private fields for testing purposes.
  // We also check after the first step, because DisabledWorkflowContext
  // doesn't have the correct invokeCount
  const invokeCount = context.executor.invokeCount
  expect(invokeCount, 2)

  let counter = 0;
  while (counter < 10) {
    const { notifyResponse } = await context.notify("notified event", notifiedEventId, "data")
    counter += 1
    await context.sleep("wait", 1)
    if (notifyResponse.length) {
      break
    }
  }

  await context.sleep("check", 1)

  return "branch-two-result"
})

export const { POST, GET } = testServe(
  serveMany({
    workflowOne,
    workflowTwo,
    workflowThree,
    branchOne,
    branchTwo,
  }),
  {
    expectedCallCount: 26,
    expectedResult: "done invoke",
    payload,
    headers: {
      [testHeader]: headerValue,
    }
  }
)