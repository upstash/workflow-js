import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-${nanoid()}`
const headerValue = `header-${nanoid()}`
const authentication = `Bearer test-auth-${nanoid()}`
const payload = "my-payload"

const someWork = (input: string) => {
  return `processed '${input}'`;
};

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      if (context.headers.get("authentication") !== authentication) {
        console.error("Authentication failed.");
        return;
      }

      const result1 = await context.run("step1", async () => {
        return await Promise.resolve(someWork(input));
      });

      expect(result1, "processed 'my-payload'");

      const result2 = await context.run("step2", async () => {
        const result = someWork(result1);
        return await Promise.resolve(result);
      });

      expect(result2, "processed 'processed 'my-payload''");
      await saveResult(
        context,
        "processed 'processed 'my-payload''"
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0
    }
  ), {
    expectedCallCount: 4,
    expectedResult: "processed 'processed 'my-payload''",
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authentication
    }
  }
) 