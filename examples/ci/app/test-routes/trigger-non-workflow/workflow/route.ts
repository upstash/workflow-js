import { serve } from "@upstash/workflow/nextjs";
import { Client, StepError } from "@upstash/workflow";
import { BASE_URL } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import { NON_WORKFLOW_ROUTE_RESPONSE } from "../constants";

const header = `test-header-foo`
const headerValue = `header-bar`

const workflowClient = new Client({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

export const { POST, GET } = testServe(
  serve(async (context) => {

    const { workflowRunId } = await context.run("trigger non-workflow", async () =>
      workflowClient.trigger({
        url: `${BASE_URL}/test-routes/trigger-non-workflow/non-workflow`,
      })
    )

    await context.sleep("wait before checking logs", 5)

    const errorBody = await context.run("check run logs", async () => {
      for (let counter = 0; counter < 5; counter++) {
        const { runs } = await workflowClient.logs({ workflowRunId })        
        if (runs.length === 1) {
          const run = runs[0];
          expect(run.workflowState, "RUN_FAILED")
          expect(run.steps.length, 2)

          const secondStep = run.steps[1];
          expect(secondStep.type, "next")
          expect(secondStep.steps.length, 1)
          expect(secondStep.steps[0].state, "STEP_FAILED")

          const errors = (secondStep.steps[0] as { errors: StepError[] }).errors;

          expect(errors.length, 1)
          expect(errors[0].error, "detected a non-workflow destination for trigger/invoke. make sure you are sending the request to the correct endpoint")
          return errors[0].body
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      return false
    })

    if (!errorBody) {
      throw new Error(`Workflow run with ID ${workflowRunId} did not complete successfully`)
    }

    await saveResult(
      context,
      errorBody
    )

  }, {
    baseUrl: BASE_URL,
    retries: 0
  }), {
  expectedCallCount: 5,
  expectedResult: NON_WORKFLOW_ROUTE_RESPONSE,
  payload: NON_WORKFLOW_ROUTE_RESPONSE,
  headers: {
    [header]: headerValue
  }
})