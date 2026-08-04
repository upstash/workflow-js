import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult, redis } from "app/ci/upstash/redis"

/**
 * this route tests step-level flow control on the *first* step of a run.
 *
 * there is no earlier step to carry the settings, so the delivery which
 * reaches `increment` is the one created when the run was triggered. On
 * reaching the step there, the SDK publishes a hidden redelivery
 * carrying the settings and the step executes in that delivery.
 *
 * the test triggers multiple concurrent runs. The `increment` step has
 * step-level parallelism of 1: only one run at a time may execute it,
 * even though the trigger-level flow control is permissive.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-first-step-active-counter"
const HOLD_DURATION_MS = 3000
const COUNTER_EXPIRY_SECS = 60

const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control-first-step"
const STEP_PARALLELISM = 1

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
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
        `first-step-flow-control-${observedActive <= STEP_PARALLELISM ? "ok" : "violated"}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    // discovery (requests the gated redelivery)
    // + redelivery (executes increment) + final
    expectedCallCount: 3,
    expectedResult: "first-step-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      // permissive trigger-level flow control: the step-level settings of
      // the `increment` step must override it
      flowControl: { key: "ci-trigger-flow-control-first-step", parallelism: 5 },
    }
  }
)
