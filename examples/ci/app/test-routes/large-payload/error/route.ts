import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { largeObject } from "../utils";
import { WorkflowContext } from "@upstash/workflow";

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "“unicode-quotes”"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      const result1 = await context.run("step1", () => {
        return input.length;
      });

      expect(result1, payload.length);

      await context.run("step2", () => {
        throw new Error(largeObject)
      });
    }, {
      baseUrl: BASE_URL,
      retries: 0,
      async failureFunction({ context, failStatus, failResponse }) {
        expect( failResponse, largeObject )
        expect( failStatus, 500 )
        expect( context.requestPayload as string, payload )
        
        await saveResult(
          context as WorkflowContext,
          `super secret`
        )
      },
    }
  ), {
    expectedCallCount: 4,
    expectedResult: `super secret`,
    payload,
    headers: {
      [ header ]: headerValue
    }
  }
)
