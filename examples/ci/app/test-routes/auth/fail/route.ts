import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { fail, saveResult } from "app/ci/upstash/redis"

const header = `test-header-foo`
const headerValue = `header-bar`
const authentication = `Bearer test-auth-super-secret`
const payload = "my-payload"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      if (context.headers.get("authentication") !== "not-correct") {
        console.error("Authentication failed.");

        await saveResult(
          context,
          "auth fails"
        )

        return;
      }

      await fail(context)
    }, {
      baseUrl: BASE_URL,
      retries: 1 // check with retries 1 to see if endpoint will retry
    }
  ), {
    expectedCallCount: 1,
    expectedResult: "auth fails",
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authentication
    }
  }
) 