import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants";
import { saveResult, redis } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";

/**
 * this route tests step-level flow control on a step which comes right
 * after a context.invoke step.
 *
 * When the invoked workflow finishes, QStash delivers its result to the
 * invoker endpoint. That delivery is published by QStash itself and
 * isn't gated by the step settings, so on reaching `increment` the SDK
 * publishes a hidden redelivery carrying the settings and the step
 * executes there.
 *
 * the test triggers multiple concurrent runs. The `increment` step has
 * step-level parallelism of 1: only one run at a time may execute it,
 * even though the trigger-level flow control is permissive.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-invoke-active-counter"
const HOLD_DURATION_MS = 3000
const COUNTER_EXPIRY_SECS = 60

const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control-invoke"
const STEP_PARALLELISM = 1

const CHILD_RESULT = "child-result"

const invokedChild = createWorkflow(async (context: WorkflowContext<string>) => {
  const childOut = await context.run("child step", async () => {
    return CHILD_RESULT
  })
  return childOut
})

const invokerParent = createWorkflow(async (context: WorkflowContext<string>) => {
  const { body, isCanceled, isFailed } = await context.invoke("invoke child", {
    workflow: invokedChild,
    body: "child-payload",
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
    retries: 0,
  })

  expect(body, CHILD_RESULT)
  expect(isCanceled, false)
  expect(isFailed, false)

  const observedActive = await context
    .run("increment", async () => {
      const active = await redis.incr(ACTIVE_COUNTER_KEY);
      await redis.expire(ACTIVE_COUNTER_KEY, COUNTER_EXPIRY_SECS);
      try {
        await new Promise((r) => setTimeout(r, HOLD_DURATION_MS));
        return active;
      } finally {
        await redis.decr(ACTIVE_COUNTER_KEY);
      }
    })
    .withSettings({
      flowControl: { key: STEP_FLOW_CONTROL_KEY, parallelism: STEP_PARALLELISM },
      retries: 0,
    });

  expect(observedActive <= STEP_PARALLELISM, true);

  await saveResult(
    context,
    `invoke-flow-control-${observedActive <= STEP_PARALLELISM ? "ok" : "violated"}`
  )
})

export const { POST, GET } = testServe(
  serveMany({
    invokerParent,
    invokedChild,
  }, {
    baseUrl: BASE_URL
  }),
  {
    // parent: trigger + invoke result delivery (discovery, requests a
    //   redelivery) + redelivery (executes increment) + final
    // child: trigger (executes child step) + final
    expectedCallCount: 6,
    expectedResult: "invoke-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-invoke", parallelism: 5 },
    }
  }
)
