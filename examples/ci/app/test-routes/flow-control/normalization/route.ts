import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

/**
 * this route checks that the step-level settings the SDK publishes come
 * back from QStash in a form the SDK recognizes.
 *
 * The gate decision compares a step's settings against the configuration
 * QStash reports on the delivery. The two sides format the same values
 * differently (QStash joins the flow control value without spaces and
 * reports periods in whole seconds; the SDK joins with ", " and sends
 * durations), so both are normalized before comparing. A normalization
 * bug makes every delivery look mismatched, which is why this route
 * asserts the round trip for a range of shapes.
 *
 * The call count matters as much as the assertions: each gated step must
 * cost exactly one step config request. A step which is republished over
 * and over would still pass the assertions below.
 */

const payloadFor = (route: string) => route

/**
 * Whether QStash reported that this delivery carried the step's own
 * settings, rather than the ones the run was triggered with.
 *
 * The SDK keeps this off its public surface — it uses it internally to
 * bound a comparison it gets wrong — but nothing else observes whether
 * the header arrives, so the assertions below reach in for it.
 */
const isGatedDelivery = (context: { headers: Headers }) =>
  (context as unknown as { effectiveConfig: { hasStepConfig: boolean } }).effectiveConfig
    .hasStepConfig

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      // parallelism only
      await context
        .run("parallelism-only", () => {
          // the guard marker has to actually arrive: nothing else
          // observes it, so a missing one would go unnoticed
          expect(isGatedDelivery(context), true)
          expect(context.flowControl?.key, "norm-parallelism")
          expect(context.flowControl?.parallelism, 2)
          expect(context.flowControl?.rate, 0)
          // QStash defaults an unset period to one second
          expect(context.flowControl?.period, 1)
          return "ok"
        })
        .withSettings({ flowControl: { key: "norm-parallelism", parallelism: 2 } })

      // rate with a numeric period
      await context
        .run("numeric-period", () => {
          expect(context.flowControl?.key, "norm-numeric-period")
          expect(context.flowControl?.rate, 10)
          expect(context.flowControl?.period, 60)
          return "ok"
        })
        .withSettings({ flowControl: { key: "norm-numeric-period", rate: 10, period: 60 } })

      // the same period expressed as a duration string
      await context
        .run("duration-period", () => {
          expect(context.flowControl?.period, 60)
          return "ok"
        })
        .withSettings({ flowControl: { key: "norm-duration-period", rate: 10, period: "1m" } })

      // ratePerSecond is an alias for rate
      await context
        .run("rate-alias", () => {
          expect(context.flowControl?.rate, 5)
          return "ok"
        })
        .withSettings({ flowControl: { key: "norm-rate-alias", ratePerSecond: 5 } })

      // retries: 0 is reported by omitting the header, so it must read
      // back as 0 rather than as "unset"
      await context
        .run("zero-retries", () => {
          expect(context.retries, 0)
          return "ok"
        })
        .withSettings({ retries: 0 })

      // a non-default retries value, with a retry delay
      await context
        .run("retries-and-delay", () => {
          expect(context.retries, 5)
          expect(context.retryDelay, "1000")
          return "ok"
        })
        .withSettings({ retries: 5, retryDelay: "1000" })

      // everything at once
      await context
        .run("combined", () => {
          expect(context.flowControl?.key, "norm-combined")
          expect(context.flowControl?.parallelism, 3)
          expect(context.flowControl?.rate, 10)
          expect(context.flowControl?.period, 7200)
          expect(context.retries, 2)
          return "ok"
        })
        .withSettings({
          flowControl: { key: "norm-combined", parallelism: 3, rate: 10, period: "2h" },
          retries: 2,
        })

      // settings which match the configuration the run was triggered
      // with: nothing to gate, so this step must cost no extra request.
      // This is the direction which loops when normalization is wrong.
      await context
        .run("same-as-trigger", () => {
          expect(context.flowControl?.key, "ci-trigger-flow-control-normalization")
          // still a gated delivery: the previous step attaches this
          // step's settings whenever it has any, without checking them
          // against the delivery in hand
          expect(isGatedDelivery(context), true)
          return "ok"
        })
        .withSettings({
          flowControl: { key: "ci-trigger-flow-control-normalization", parallelism: 5 },
          retries: 0,
        })

      // a step with no settings at all: nothing is attached to the
      // previous step's submission, so this runs on an ordinary delivery
      // and the marker must be absent. Without this the assertions above
      // would also pass if QStash set the marker unconditionally.
      await context.run("no-settings", () => {
        expect(isGatedDelivery(context), false)
        expect(context.flowControl?.key, "ci-trigger-flow-control-normalization")
        return "ok"
      })

      await saveResult(context, "normalization-ok")
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    // 9 steps. Only the first needs a step config request: once a step
    // executes, the next step's settings ride on its submission.
    //
    //   step config request for step 1 + its gated delivery  = 2
    //   steps 2..9, each executing on the delivery carrying
    //     the previous step's result                         = 8
    //   final replay                                         = 1
    expectedCallCount: 11,
    expectedResult: "normalization-ok",
    payload: payloadFor("normalization"),
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-normalization", parallelism: 5 },
    }
  }
)
