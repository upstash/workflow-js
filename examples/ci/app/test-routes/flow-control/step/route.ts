import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult, redis } from "app/ci/upstash/redis"

/**
 * this route tests step-level flow control settings.
 *
 * the test triggers multiple concurrent runs of this workflow. The trigger
 * level flow control is permissive (high parallelism), but the `increment`
 * step has step-level parallelism of 1: even when the runs are concurrent,
 * only one run at a time may execute the `increment` step.
 *
 * each execution of the `increment` step increments a shared counter on
 * redis, holds it for a while and decrements it. If the step-level flow
 * control is applied, the observed counter value can never exceed the
 * step-level parallelism.
 */

const ACTIVE_COUNTER_KEY = "wf-step-flow-control-active-counter"
const HOLD_DURATION_MS = 3000
const COUNTER_EXPIRY_SECS = 60

const STEP_FLOW_CONTROL_KEY = "ci-step-flow-control"
const STEP_PARALLELISM = 1

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      // carrier step: makes `increment` a step which is reached by
      // replaying the workflow in the delivery of this step's result
      await context.run("init", () => "init");

      const observedActive = await context
        .run("increment", async () => {
          const active = await redis.incr(ACTIVE_COUNTER_KEY);
          await redis.expire(ACTIVE_COUNTER_KEY, COUNTER_EXPIRY_SECS);
          try {
            // hold the slot: concurrent runs would overlap here if the
            // step-level flow control isn't applied
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
        `step-flow-control-${observedActive <= STEP_PARALLELISM ? "ok" : "violated"}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    // `init` has no settings, so it executes on the first delivery and
    // the route function continues to `increment`, whose settings ride on
    // `init`'s submission. No step config request is needed.
    //
    //   init, submitted with increment's settings  = 1
    //   gated delivery, executes increment         = 1
    //   final replay                               = 1
    expectedCallCount: 3,
    expectedResult: "step-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      // permissive trigger-level flow control: the step-level settings of
      // the `increment` step must override it
      flowControl: { key: "ci-trigger-flow-control", parallelism: 5 },
    }
  }
)
