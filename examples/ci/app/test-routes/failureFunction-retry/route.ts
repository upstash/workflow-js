import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import * as redis from "app/ci/upstash/redis"
import { WorkflowContext } from "@upstash/workflow";

const header = `test-header-foo`
const headerValue = `header-bar`
const authHeaderValue = `Bearer super-secret-token`

const errorMessage = `my-error`
const payload = "my-payload"

const counter_route = "failureFuction-retry-call-counter"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      await context.run("step1", () => {
        redis.increment(
          counter_route,
          context.headers.get(CI_RANDOM_ID_HEADER)!
        )
        throw new Error(errorMessage);
      });
    }, {
      baseUrl: BASE_URL,
      failureFunction: async ({ context, failStatus, failResponse }) => {
        expect(failStatus, 500);
        expect(failResponse, errorMessage);
        expect(context.headers.get("authentication")!, authHeaderValue);

        // save the counter and check it
        await redis.saveResultsWithoutContext(
          counter_route,
          context.headers.get(CI_RANDOM_ID_HEADER)!,
          ""
        )
        await redis.checkRedisForResults(
          counter_route,
          context.headers.get(CI_RANDOM_ID_HEADER)!,
          2,
          ""
        )
        
        await redis.saveResult(
          context as WorkflowContext,
          `${failResponse}`
        )
      },
    }
  ), {
    expectedCallCount: 4,
    expectedResult: `${errorMessage}`,
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authHeaderValue
    },
    triggerConfig: {
      retries: 1,
    }
  }
)
