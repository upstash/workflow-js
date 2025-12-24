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

      const [result1, largeResult1] = await Promise.all([
        context.run("step 1", () => undefined),
        context.run("step 2 - large", () => {
          return largeObject;
        })
      ])

      expect(typeof result1, "undefined");
      expect(typeof largeResult1, "string");
      expect(largeResult1.length, largeObjectLength);
      expect(largeResult1, largeObject);

      const [largeResult2, result2] = await Promise.all([
        context.run("step 3 - large", () => {
          return largeObject;
        }),
        context.run("step 4", () => undefined),
      ])

      expect(typeof result2, "undefined");
      expect(typeof largeResult2, "string");
      expect(largeResult2.length, largeObjectLength);
      expect(largeResult2, largeObject);

      await saveResult(
        context,
        `${largeResult1.length} - ${largeResult2.length}`
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    expectedCallCount: 10,
    expectedResult: `${largeObjectLength} - ${largeObjectLength}`,
    payload,
    headers: {
      [ header ]: headerValue
    },
    triggerConfig: {
      retries: 0,
    }
  }
) 