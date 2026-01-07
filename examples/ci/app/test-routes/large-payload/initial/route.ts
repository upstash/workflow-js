import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { largeObject } from "../utils";
import { WorkflowContext } from "@upstash/workflow";

const header = `test-header-foo`
const headerValue = `header-bar`
const throws = "throwing-foo"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, largeObject);
      expect(context.headers.get(header)!, headerValue)

      const result1 = await context.run("step1", () => {
        return input.length;
      });

      expect(result1, largeObject.length);

      const result2 = await context.run("step2", () => {
        return input
      });

      expect(result2, largeObject);

      await context.run("throws", () => {
        throw new Error(throws)
      })
    }, {
      baseUrl: BASE_URL,
      async failureFunction({ context, failResponse }) {
        expect(context.requestPayload as string, largeObject)
        expect(failResponse, throws)

        await saveResult(
          context as WorkflowContext,
          throws
        )
      },
    }
  ), {
    expectedCallCount: 4,
    expectedResult: throws,
    payload: largeObject,
    headers: {
      [ header ]: headerValue
    },
    triggerConfig: {
      retries: 0,
    }
  }
)
