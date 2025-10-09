import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { CUSTOM_CONTENT_TYPE, DELETE_RESULT, FAILING_HEADER, FAILING_HEADER_VALUE, GET_HEADER, GET_HEADER_VALUE, PATCH_RESULT } from "../constants";

const testHeader = `test-header-foo`
const headerValue = `header-foo`
const payload = "my-payload"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/call/third-party`
const postHeader = {
  "post-header": "post-header-value-x",
  "content-type": CUSTOM_CONTENT_TYPE
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

      expect(context.headers.get(testHeader)!, headerValue)

      const { body: postResult, status: postStatus } = await context.call("post call", {
        url: thirdPartyEndpoint,
        method: "POST",
        body: "post-payload",
        headers: postHeader,
      });

      // check payload after first step because we can't check above
      expect(input, payload);
      expect(postStatus, 201)

      expect(postResult as string,
        "called POST 'third-party-result' 'post-header-value-x' '\"post-payload\"'"
      );

      await context.sleep("sleep 1", 2);

      const { body: getResult, header: getHeaders, status: getStatus } = await context.call<string>("get call", {
        url: thirdPartyEndpoint,
        headers: getHeader,
      });

      expect(getStatus, 200)
      expect(getHeaders[GET_HEADER][0], GET_HEADER_VALUE)
      expect(getResult, "called GET 'third-party-result' 'get-header-value-x'");

      const { body: patchResult, status, header } = await context.call<number>("patch call", {
        url: thirdPartyEndpoint,
        headers: getHeader,
        method: "PATCH",
        retries: 1
      });

      expect(status, 401)
      expect(patchResult, PATCH_RESULT);
      expect(header[FAILING_HEADER][0], FAILING_HEADER_VALUE)

      // put will return with an empty body. should return "" as body in that case.
      const { body: putBody, status: putStatus } = await context.call<string>("put call", {
        url: thirdPartyEndpoint,
        method: "PUT",
        retries: 0
      })

      expect(putStatus, 300)
      expect(putBody, "");

      // DELETE will return a JSON
      const { body: deleteBody, status: deleteStatus } = await context.call<{ foo: string, zed: number }>("delete call", {
        url: thirdPartyEndpoint,
        method: "DELETE",
        retries: 0
      })

      expect(deleteStatus, 400)
      expect(typeof deleteBody, "object");
      expect(JSON.stringify(deleteBody), JSON.stringify(DELETE_RESULT));

      await saveResult(
        context,
        getResult
      )
    }, {
    baseUrl: BASE_URL,
    retries: 0
  }
  ), {
  expectedCallCount: 13,
  expectedResult: "called GET 'third-party-result' 'get-header-value-x'",
  payload,
  headers: {
    [testHeader]: headerValue,
  }
}
) 