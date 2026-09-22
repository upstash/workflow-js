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
 * the step which carries settings is the *first* step of the worker, so there is no
 * earlier step to carry its settings: the delivery which reaches it is
 * the one that started the run. The SDK publishes a step config request
 * and the step executes in the delivery that request produces.
 *
 * See `../../../shared.ts` for what the workers assert.
 */

const ACTIVE_COUNTER = "wf-step-flow-control-first-step-active-counter";
const FLOW_CONTROL = "ci-step-flow-control-first-step";

const worker = createWorkflow(async (context: WorkflowContext<number>) => {
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

  await saveResult(context, `first-step-flow-control-${withinLimit ? "ok" : "violated"}`);
});

export const { POST, GET } = testServe(
  serveMany({ coordinator, worker }, { baseUrl: BASE_URL }),
  {
    expectedCallCount: 16,
    expectedResult: "first-step-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-first-step", parallelism: 5 },
    },
  }
);
