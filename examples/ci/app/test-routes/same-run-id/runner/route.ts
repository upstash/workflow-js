import { Client, WorkflowNonRetryableError } from "@upstash/workflow";
import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import { RUNNER_RESULT, TARGET_PAYLOAD, TARGET_RUN_ID, TARGET_STEP_NAMES } from "../constants";

/**
 * Starts the target twice with the same workflow run id and the same data, one run
 * after the other, and checks in the logs that each run finished successfully with
 * all of its steps. See ../constants.ts for why.
 */

const workflowClient = new Client({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

// the clocks of QStash and the deployment may differ by a little
const CLOCK_SKEW_MS = 10_000

const startTarget = async () => {
  // a run left over from an earlier CI run would make the trigger fail, since the id is taken
  await workflowClient.cancel(`wfr_${TARGET_RUN_ID}`).catch(() => {})

  const startedAt = Date.now()
  const { workflowRunId } = await workflowClient.trigger({
    url: `${TEST_ROUTE_PREFIX}/same-run-id/workflows/target`,
    workflowRunId: TARGET_RUN_ID,
    body: TARGET_PAYLOAD,
    retries: 0,
  })
  return { workflowRunId, startedAt }
}

/**
 * waits for the one run of the target created after `createdAfter` to finish, checks it
 * and returns its creation time
 */
const checkTargetRun = async (workflowRunId: string, createdAfter: number) => {
  for (let i = 0; i < 20; i++) {
    const { runs } = await workflowClient.logs({ filter: { workflowRunId } })
    const newRuns = runs.filter(run => run.workflowRunCreatedAt > createdAfter)
    if (newRuns.length > 1) {
      throw new WorkflowNonRetryableError(`expected one new run of ${workflowRunId}, found ${newRuns.length}`)
    }

    const run = newRuns[0]
    if (run && run.workflowState !== "RUN_STARTED") {
      expect(run.workflowState, "RUN_SUCCESS")
      expect(run.steps.some(group => group.type === "next"), false)

      const steps = run.steps.flatMap(group => group.type === "next" ? [] : group.steps)
      expect(
        JSON.stringify(steps.map(step => step.stepName).sort()),
        JSON.stringify([...TARGET_STEP_NAMES].sort())
      )
      for (const step of steps) {
        expect(`${step.stepName}: ${step.state}`, `${step.stepName}: STEP_SUCCESS`)
      }
      return run.workflowRunCreatedAt
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new WorkflowNonRetryableError(`the run of ${workflowRunId} created after ${createdAfter} didn't finish in time`)
}

export const { POST, GET } = testServe(
  serve(async (context) => {

    const first = await context.run("start first run", startTarget)
    await context.sleep("wait for first run", 20)
    const firstCreatedAt = await context.run("check first run", () =>
      checkTargetRun(first.workflowRunId, first.startedAt - CLOCK_SKEW_MS)
    )

    // same id, same data: before Upstash-Workflow-CreatedAt, this run was deduplicated
    const second = await context.run("start second run", startTarget)
    expect(second.workflowRunId, first.workflowRunId)
    await context.sleep("wait for second run", 20)
    await context.run("check second run", () =>
      checkTargetRun(second.workflowRunId, firstCreatedAt)
    )

    await saveResult(context, RUNNER_RESULT)
  }, {
    baseUrl: BASE_URL,
  }), {
    expectedCallCount: 7,
    expectedResult: RUNNER_RESULT,
    payload: undefined,
    triggerConfig: {
      retries: 0,
    }
  }
)
