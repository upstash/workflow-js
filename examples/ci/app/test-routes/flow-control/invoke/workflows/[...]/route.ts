import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import {
  ciHeaders,
  incrementSettings,
  incrementStep,
  perRunKey,
  withinStepParallelism,
  WORKER_COUNT,
} from "../../../shared";

/**
 * the step which carries settings comes after a `context.invoke` step, so
 * the delivery which reaches it is the one QStash publishes with the
 * invoked run's result. That is an ordinary delivery — nothing about it
 * was shaped by the step's settings — so reaching `increment` there, the
 * SDK publishes a step config request and the step executes in the
 * delivery that produces.
 *
 * See `../../../shared.ts` for what the workers assert.
 */

const ACTIVE_COUNTER = "wf-step-flow-control-invoke-active-counter";
const FLOW_CONTROL = "ci-step-flow-control-invoke";

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

  return await context.run(
    "increment",
    incrementStep(perRunKey(context, ACTIVE_COUNTER)),
    incrementSettings(perRunKey(context, FLOW_CONTROL))
  );
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
