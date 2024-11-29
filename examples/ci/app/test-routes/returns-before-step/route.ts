import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER } from "app/ci/constants";
import { expect, testServe } from "app/ci/utils";
import { redis, saveResult, fail } from "app/ci/upstash/redis"
import { WorkflowContext } from "@upstash/workflow";

const secret = "super-secret-key"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const redisKey = `redis-key-${context.headers.get(CI_RANDOM_ID_HEADER)}`
      const count = await redis.incr(redisKey)
      if (count === 1) {
        // allow in the first encounter
        await context.run("mock step", () => {})
      } else if (count === 2) {
        // return after the step, which should return 400
        return
      } else if (count === 3) {
        // coming back for failureFunction. put a mock step to allow it
        await context.run("mock step", () => {})
      }

      // otherwise fail.
      await fail(context);
    }, {
      baseUrl: BASE_URL,
      retries: 0,
      async failureFunction({ context, failStatus, failResponse }) {
        expect(failStatus, 400)
        expect(failResponse, `Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run`)
        await saveResult(
          context as WorkflowContext,
          secret
        )
      }
    }
  ), {
    expectedCallCount: 3,
    expectedResult: secret,
    payload: undefined,
  }
)
