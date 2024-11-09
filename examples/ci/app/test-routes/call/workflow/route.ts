import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-${nanoid()}`
const headerValue = `header-${nanoid()}`
const payload = "my-payload"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/call/third-party`
const postHeader = {
  "post-header": "post-header-value-x",
};
const getHeader = {
  "get-header": "get-header-value-x",
};

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const input = context.requestPayload;

      // TODO: can't check payload here because
      // payload doesn't exist in handle third party call:
      // expect(input, payload);

      expect(context.headers.get(header)!, headerValue)

      const { body: postResult } = await context.call("post call", {
        url: thirdPartyEndpoint,
        method: "POST",
        body: "post-payload",
        headers: postHeader,
      });

      // check payload after first step because we can't check above
      expect(input, payload);

      expect(postResult as string, 
        "called POST 'third-party-result' 'post-header-value-x' '\"post-payload\"'"
      );

      await context.sleep("sleep 1", 2);

      const { body: getResult } = await context.call("get call", {
        url: thirdPartyEndpoint,
        headers: getHeader,
      });

      expect(getResult as string, "called GET 'third-party-result' 'get-header-value-x'");

      const { body: patchResult, status } = await context.call("get call", {
        url: thirdPartyEndpoint,
        headers: getHeader,
        method: "PATCH"
        // TODO: add retry
      });

      expect(status, 401)
      expect(patchResult as string, "failing request");

      await saveResult(
        context,
        getResult as string
      )
    }, {
      baseUrl: BASE_URL,
      retries: 1
    }
  ), {
    expectedCallCount: 9,
    expectedResult: "called GET 'third-party-result' 'get-header-value-x'",
    payload,
    headers: {
      [ header ]: headerValue,
    }
  }
) 