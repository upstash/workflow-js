import { Client, StepError, WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants";
import { fail, saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";

const testHeader = "test-header-quota-error"
const headerValue = "quota-error-header-value"
const payload = "quota-error-payload"
const expectedResult = "quota-error-test-complete"

const HUGE_RETRY = 1_000_000

const workflowClient = new Client({
  baseUrl: process.env.QSTASH_URL,
  token: process.env.QSTASH_TOKEN!,
})

/**
 * Sub-workflow 1: single context.call with huge retry value
 * Should fail with 412 quota error wrapped in WorkflowNonRetryableError
 */
const singleCallWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  await context.call("huge retry call", {
    url: "https://httpstat.us/200",
    method: "GET",
    retries: HUGE_RETRY,
  })
})

/**
 * Sub-workflow 2: two parallel context.calls, one with huge retry value
 * Should fail with 412 quota error wrapped in WorkflowNonRetryableError
 */
const parallelCallWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  await Promise.all([
    context.call("normal call", {
      url: "https://httpstat.us/200",
      method: "GET",
      retries: 0,
    }),
    context.call("huge retry call", {
      url: "https://httpstat.us/200",
      method: "GET",
      retries: HUGE_RETRY,
    }),
  ])
})

/**
 * Parent workflow: triggers both sub-workflows via context.call,
 * then checks their logs to verify they failed with the right error
 */
const mainWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  expect(context.headers.get(testHeader)!, headerValue)

  // Trigger both sub-workflows using context.call with workflow param
  // This returns the workflowRunId immediately without waiting for completion
  const [singleCallResult, parallelCallResult] = await Promise.all([
    context.call("call single call workflow", {
      workflow: singleCallWorkflow,
      body: "test",
      headers: {
        [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
        [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
      },
      retries: 0
    }),
    context.call("call parallel call workflow", {
      workflow: parallelCallWorkflow,
      body: "test",
      headers: {
        [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
        [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
      },
      retries: 0
    }),
  ])

  expect(typeof singleCallResult.body.workflowRunId, "string")
  expect(typeof parallelCallResult.body.workflowRunId, "string")

  // Wait for the sub-workflows to fail
  await context.sleep("wait for sub-workflows to fail", 5)

  // Check logs for singleCallWorkflow
  await context.run("check single call logs", async () => {
    for (let i = 0; i < 5; i++) {
      const logs = await workflowClient.logs({
        workflowRunId: singleCallResult.body.workflowRunId
      })

      if (logs.runs.length === 0 || logs.runs[0].workflowState !== "RUN_FAILED") {
        console.log("waiting for single call logs...", i)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }

      const run = logs.runs[0]
      expect(run.workflowState, "RUN_FAILED")

      // Find the failed step
      const failedStepGroup = run.steps.find(s => s.type === "next")
      if (!failedStepGroup || failedStepGroup.type !== "next") {
        throw new WorkflowNonRetryableError("Expected a 'next' step in single call workflow logs")
      }

      expect(failedStepGroup.steps.length, 1)
      expect(failedStepGroup.steps[0].state, "STEP_FAILED")

      const errors = failedStepGroup.steps[0].errors
      if (!errors || errors.length === 0) {
        throw new WorkflowNonRetryableError("Expected errors in single call workflow logs")
      }

      // The error should be a NonRetryableError (status 489)
      expect(errors[0].status, 489)
      return
    }
    throw new WorkflowNonRetryableError("Failed to get single call workflow logs after retries")
  })

  // Check logs for parallelCallWorkflow
  await context.run("check parallel call logs", async () => {
    for (let i = 0; i < 5; i++) {
      const logs = await workflowClient.logs({
        workflowRunId: parallelCallResult.body.workflowRunId
      })

      if (logs.runs.length === 0 || logs.runs[0].workflowState !== "RUN_FAILED") {
        console.log("waiting for parallel call logs...", i)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }

      const run = logs.runs[0]
      expect(run.workflowState, "RUN_FAILED")

      // Find the parallel step group
      const failedStepGroup = run.steps.find(s => s.type === "parallel")
      if (!failedStepGroup || failedStepGroup.type !== "parallel") {
        throw new WorkflowNonRetryableError("Expected a 'parallel' step in parallel call workflow logs")
      }

      // Find the step that failed among the parallel steps
      const failedStep = failedStepGroup.steps.find(s => s.state === "STEP_FAILED")
      if (!failedStep) {
        throw new WorkflowNonRetryableError("Expected a failed step in parallel call workflow logs")
      }

      const errors = (failedStep as unknown as { errors: StepError[] }).errors
      if (!errors || errors.length === 0) {
        throw new WorkflowNonRetryableError("Expected errors in parallel call workflow logs")
      }

      // The error should be a NonRetryableError (status 489)
      expect(errors[0].status, 489)
      return
    }
    throw new WorkflowNonRetryableError("Failed to get parallel call workflow logs after retries")
  })

  await saveResult(
    context,
    expectedResult,
  )
})

export const { POST, GET } = testServe(
  serveMany(
    {
      mainWorkflow,
      singleCallWorkflow,
      parallelCallWorkflow,
    },
    {
      baseUrl: BASE_URL,
      receiver: undefined,
      failureFunction: async ({ context, failResponse }) => {
        console.error("failing:", failResponse);
        await fail(context as WorkflowContext)
      }
    }
  ), {
    expectedCallCount: 16,
    expectedResult,
    payload,
    headers: {
      [testHeader]: headerValue,
    },
    triggerConfig: {
      retries: 0
    }
  }
)
