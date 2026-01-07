import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "my-payload"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      const result1 = await context.run("async step", async () => {
        return await Promise.resolve("result1");
      });

      expect(result1, "result1");

      const result2 = await context.run("sync step", () => {
        return "result2";
      });

      expect(result2, "result2");

      const result3 = await context.run("sync step returning promise", () => {
        return Promise.resolve("result3");
      });

      expect(result3, "result3");

      await saveResult(
        context,
        `${result1} ${result2} ${result3}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    expectedCallCount: 4,
    expectedResult: `result1 result2 result3`,
    payload,
    headers: {
      [ header ]: headerValue,
    },
    triggerConfig: {
      retries: 0
    }
  }
) 