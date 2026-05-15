import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { GET_HEADER, GET_HEADER_VALUE } from "../constants";
import { z } from "zod";

const testHeader = `test-header-foo`
const headerValue = `header-foo`

const schema = z.object({
  name: z.string(),
  count: z.number(),
})

const payload = { name: "with-schema-payload", count: 7 }

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/call/third-party`
const getHeader = {
  "get-header": "get-header-value-x",
};

export const { POST, GET } = testServe(
  serve(
    async (context) => {
      expect(context.headers.get(testHeader)!, headerValue)

      const { body: getResult, header: getHeaders, status: getStatus } = await context.call<string>("get call", {
        url: thirdPartyEndpoint,
        headers: getHeader,
      });

      const input = context.requestPayload

      expect(input.name, payload.name)
      expect(input.count, payload.count)

      expect(getStatus, 200)
      expect(getHeaders[GET_HEADER][0], GET_HEADER_VALUE)
      expect(getResult, "called GET 'third-party-result' 'get-header-value-x'");

      await saveResult(
        context,
        getResult
      )
    }, {
      baseUrl: BASE_URL,
      schema,
    }
  ), {
    expectedCallCount: 3,
    expectedResult: "called GET 'third-party-result' 'get-header-value-x'",
    payload,
    headers: {
      [ testHeader ]: headerValue,
    },
    triggerConfig: {
      retries: 0,
    }
  }
)
