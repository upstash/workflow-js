import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import {
  ciHeaders,
  incrementSettings,
  incrementStep,
  wasGated,
  WORKER_COUNT,
} from "../../../shared";

/**
 * the gated step comes after a `context.run` step, so the delivery which
 * reaches it is the one carrying that step's result. The SDK is already
 * past a step when it learns about `increment`, so the settings ride on
 * the previous step's submission and no step config request is needed.
 *
 * See `../../../shared.ts` for what the workers assert.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-active-counter";
const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control";

const worker = createWorkflow(async (context: WorkflowContext<number>) => {
  // carrier step: makes `increment` a step which is reached by replaying
  // the workflow in the delivery of this step's result
  await context.run("init", () => "init");

  return await context
    .run("increment", incrementStep(ACTIVE_COUNTER_KEY))
    .withSettings(incrementSettings(STEP_FLOW_CONTROL_KEY));
});

const coordinator = createWorkflow(async (context: WorkflowContext<unknown>) => {
  const results = await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, index) =>
      context.invoke(`worker ${index}`, {
        workflow: worker,
        body: index,
        headers: ciHeaders(context),
        retries: 0,
      })
    )
  );

  const gated = wasGated(results.map(({ body }) => body));
  expect(gated, true);

  await saveResult(context, `step-flow-control-${gated ? "ok" : "violated"}`);
});

export const { POST, GET } = testServe(
  serveMany({ coordinator, worker }, { baseUrl: BASE_URL }),
  {
    expectedCallCount: 16,
    expectedResult: "step-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      // permissive trigger-level flow control: the step-level settings of
      // the `increment` step must override it
      flowControl: { key: "ci-trigger-flow-control", parallelism: 5 },
    },
  }
);
