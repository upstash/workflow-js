import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { WorkflowContext } from "@upstash/workflow";

const header = `test-header-foo`
const headerValue = `header-bar`
const authHeaderValue = `Bearer super-secret-token`

const errorMessage = `my-error`
const payload = "my-payload"


export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      await context.run("step1", () => {
        throw new Error(errorMessage);
      });
    }, {
      baseUrl: BASE_URL,
      retries: 0,
      failureFunction: async (context, failStatus, failResponse) => {
        expect(failStatus, 500);
        expect(failResponse, errorMessage);
        expect(context.headers.get("authentication")!, authHeaderValue);

        await saveResult(
          context as WorkflowContext,
          failResponse
        )
      },
    }
  ), {
    expectedCallCount: 3,
    expectedResult: errorMessage,
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authHeaderValue
    }
  }
) 