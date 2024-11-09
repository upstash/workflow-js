import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-${nanoid()}`
const headerValue = `header-${nanoid()}`
const authentication = `Bearer test-auth-${nanoid()}`
const payload = "my-payload"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const input = context.requestPayload;

      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)

      if (context.headers.get("authentication") !== nanoid()) {
        console.error("Authentication failed.");

        await saveResult(
          context,
          "auth fails"
        )

        return;
      }

      throw new Error("shouldn't come here.")
    }, {
      baseUrl: BASE_URL,
      retries: 1
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