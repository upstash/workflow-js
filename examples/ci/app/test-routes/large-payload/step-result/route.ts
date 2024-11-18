import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { largeObject, largeObjectLength } from "../utils";

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "foo"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      const result1 = await context.run("step1", () => {
        return largeObject;
      });

      expect(result1, largeObject);
      expect(typeof result1, "string");
      expect(result1.length, largeObjectLength);

      const result2 = await context.run("step2", () => {
        return result1.length;
      });      

      expect(result2, largeObjectLength);

      await saveResult(
        context,
        result2.toString()
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0
    }
  ), {
    expectedCallCount: 4,
    expectedResult: largeObjectLength.toString(),
    payload,
    headers: {
      [ header ]: headerValue
    }
  }
) 