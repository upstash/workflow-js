import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
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
 * the step which carries settings comes after a `context.invoke` step. QStash publishes
 * the delivery which carries the invoked run's result, so it does not carry them. Reaching the step there, the SDK publishes ated
 * by the step settings: reaching `increment` there, the SDK publishes a
 * step config request and the step executes in the delivery that
 * produces.
 *
 * See `../../../shared.ts` for what the workers assert.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-invoke-active-counter";
const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control-invoke";

const CHILD_RESULT = "child-result";

const workerChild = createWorkflow(async (context: WorkflowContext<string>) => {
  return await context.run("child step", () => CHILD_RESULT);
});

const worker = createWorkflow(async (context: WorkflowContext<number>) => {
  const { body, isCanceled, isFailed } = await context.invoke("invoke child", {
    workflow: workerChild,
    body: "child-payload",
    headers: ciHeaders(context),
    retries: 0,
  });

  expect(body, CHILD_RESULT);
  expect(isCanceled, false);
  expect(isFailed, false);

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

  await saveResult(context, `invoke-flow-control-${withinLimit ? "ok" : "violated"}`);
});

export const { POST, GET } = testServe(
  serveMany({ coordinator, worker, workerChild }, { baseUrl: BASE_URL }),
  {
    expectedCallCount: 25,
    expectedResult: "invoke-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-invoke", parallelism: 5 },
    },
  }
);
