import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import {
  ciHeaders,
  incrementSettings,
  incrementStep,
  withinStepParallelism,
  WORKER_COUNT,
} from "../../../shared";

/**
 * the step which carries settings comes after a `context.call` step. The delivery which
 * carries the call result back into the workflow is published before the
 * SDK knows about `increment`, so it does not carry them. Reaching the step there, the SDK publishes ated: reaching the step
 * there, the SDK publishes a step config request and the step executes
 * in the delivery that request produces.
 *
 * See `../../../shared.ts` for what the workers assert.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-call-active-counter";
const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control-call";

const worker = createWorkflow(async (context: WorkflowContext<number>) => {
  const { status, body } = await context.call<{ ok: boolean }>("call target", {
    url: `${TEST_ROUTE_PREFIX}/flow-control/call/target`,
    method: "POST",
    body: "hello",
    retries: 0,
  });

  expect(status, 200);
  expect(body.ok, true);

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

  const withinLimit = withinStepParallelism(results.map(({ body }) => body));
  expect(withinLimit, true);

  await saveResult(context, `call-flow-control-${withinLimit ? "ok" : "violated"}`);
});

export const { POST, GET } = testServe(
  serveMany({ coordinator, worker }, { baseUrl: BASE_URL }),
  {
    expectedCallCount: 22,
    expectedResult: "call-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-call", parallelism: 5 },
    },
  }
);
