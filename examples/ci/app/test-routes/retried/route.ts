import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "retried-payload"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      // context.retried reflects the QStash `Upstash-Retried` header for the
      // current delivery. It must be a number.
      expect(typeof context.retried, "number")

      // On the first delivery of this step QStash sets Upstash-Retried: 0,
      // we throw to force a retry. On the retry QStash sets it to 1 and we
      // assert the new value and complete the step.
      const observedRetried = await context.run("force-retry", () => {
        if (context.retried === 0) {
          throw new Error("forcing-retry")
        }
        return context.retried
      })

      expect(observedRetried, 1)

      await saveResult(
        context,
        `retried=${observedRetried}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    // first delivery + retried delivery + post-step continuation
    expectedCallCount: 3,
    expectedResult: "retried=1",
    payload,
    headers: {
      [ header ]: headerValue
    },
    triggerConfig: {
      retries: 1,
    }
  }
)
