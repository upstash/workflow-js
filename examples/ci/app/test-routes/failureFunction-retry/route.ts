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

let counter = 0

const { POST, GET: getHandler } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      await context.run("step1", () => {
        counter += 1
        throw new Error(errorMessage);
      });
    }, {
      baseUrl: BASE_URL,
      retries: 1,
      failureFunction: async (context, failStatus, failResponse) => {
        expect(failStatus, 500);
        expect(failResponse, errorMessage);
        expect(context.headers.get("authentication")!, authHeaderValue);
        expect(counter, 2);
        
        await saveResult(
          context as WorkflowContext,
          `${failResponse} ${counter}`
        )
      },
    }
  ), {
    expectedCallCount: 4,
    expectedResult: `${errorMessage} 2`,
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authHeaderValue
    }
  }
)

const GET = async () => {
  
  const response = await getHandler()

  // set counter to 0 everytime a test starts
  // (we call GET once everytime we are going to test an endpoint)
  counter = 0

  return response
}

export { POST, GET }