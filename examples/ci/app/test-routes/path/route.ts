import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "“unicode-quotes”"

const someWork = (input: string) => {
  return `processed '${input}'`;
};

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      const result1 = await context.run("step1", async () => {
        return await Promise.resolve(someWork(input));
      });

      expect(result1, "processed '“unicode-quotes”'");

      const result2 = await context.run("step2", async () => {
        const result = someWork(result1);
        return await Promise.resolve(result);
      });

      expect(result2, "processed 'processed '“unicode-quotes”''");

      const result3 = await context.run("step 3", () => true)
      expect(result3, true)
      expect(typeof result3, "boolean")
      
      await saveResult(
        context,
        result2
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    expectedCallCount: 4,
    expectedResult: "processed 'processed '“unicode-quotes”''",
    payload,
    headers: {
      [ header ]: headerValue
    },
    triggerConfig: {
      retries: 0,
    }
  }
)
