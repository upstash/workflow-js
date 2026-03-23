
import { Client, WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { testServe } from "app/ci/utils";

const client = new Client({
  baseUrl: process.env.QSTASH_URL!,
  token: process.env.QSTASH_TOKEN!,
})

const FAILING_STEP_NAME = "failing step"
const INVOKE_CHILD_STEP_NAME = "invoke child"

const workflow = createWorkflow(async (context: WorkflowContext) => {
  const workflowRunId = await context.run("step 1", async () => {
    console.log("workflow says hi")
    return `workflow-run-id-${(Math.random() * 1000).toFixed(0)}`
  })

  await context.invoke("invoke child", {
    workflow: testWorkflow,
    body: undefined,
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
    workflowRunId,
  })

  await context.run("verify step", async () => {

    for (let i = 0; i < 30; i++) {
      const workflowLogs = await client.logs({ workflowRunId: `wfr_${workflowRunId}` })
      const workflowRun = workflowLogs.runs[0]

      if (workflowRun && workflowRun.steps[1] && workflowRun.steps[1].type === "parallel") {
        const invokeChild = workflowRun.steps[1].steps?.find(s => s.stepName === INVOKE_CHILD_STEP_NAME)
        const failingStep = workflowRun.steps[1].steps?.find(s => s.stepName === FAILING_STEP_NAME)

        if (invokeChild && invokeChild.state === "STEP_SUCCESS" && failingStep && failingStep.state === "STEP_FAILED") {
          return { success: true }
        }
      }
      // sleep for 1 sec
      await new Promise(r => setTimeout(r, 1000));
    }

    console.warn("child workflow did not fail within expected time");
    throw new WorkflowNonRetryableError("child workflow did not fail within expected time")
  })

  await saveResult(
    context,
    "done invoke"
  )
})

const testWorkflow = createWorkflow(async (context: WorkflowContext) => {
  await Promise.all([
    context.invoke(INVOKE_CHILD_STEP_NAME, {
      workflow: childWorkflow,
      body: undefined,
      headers: {
        [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
        [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
      },
    }),
    context.run(FAILING_STEP_NAME, async () => {
      // sleep for 1 sec
      await new Promise(r => setTimeout(r, 1000));
      throw new WorkflowNonRetryableError("step failed")
    })
  ])

})

const childWorkflow = createWorkflow(async (context: WorkflowContext) => {
  await context.sleep("sleep 3s", 3)
  await context.run("child step", async () => {
    console.log("child workflow step")
  })
})

export const { POST, GET } = testServe(serveMany({
  workflow,
  testWorkflow,
  childWorkflow,
}, {
  baseUrl: BASE_URL
}),
  {
    expectedCallCount: 11,
    expectedResult: "done invoke",
    payload: undefined,
  }
)
