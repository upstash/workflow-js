import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult, redis } from "app/ci/upstash/redis"

/**
 * this route tests step-level flow control on a step which comes right
 * after a context.call step.
 *
 * the settings of the step after the call can only be discovered when
 * the call result arrives: the SDK replays the workflow with the call
 * result (discovery) and attaches the discovered settings to the call
 * result submission.
 *
 * the test triggers multiple concurrent runs. The `increment` step has
 * step-level parallelism of 1: only one run at a time may execute it,
 * even though the trigger-level flow control is permissive.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-call-active-counter"
const HOLD_DURATION_MS = 3000
const COUNTER_EXPIRY_SECS = 60

const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control-call"
const STEP_PARALLELISM = 1

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const { status, body } = await context.call<{ ok: boolean }>("call target", {
        url: `${TEST_ROUTE_PREFIX}/flow-control/call/target`,
        method: "POST",
        body: "hello",
        retries: 0,
      });

      expect(status, 200);
      expect(body.ok, true);

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
        `call-flow-control-${observedActive <= STEP_PARALLELISM ? "ok" : "violated"}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    // trigger + call callback + call result (executes increment) + final
    expectedCallCount: 4,
    expectedResult: "call-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-call", parallelism: 5 },
    }
  }
)
