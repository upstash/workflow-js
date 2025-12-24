import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { GET_HEADER, GET_HEADER_VALUE, largeObject, largeObjectLength } from "../../utils";

const header = `test-header-foo`
const headerValue = `header-bar`
const payload = "“unicode-quotes”"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/large-payload/call-result/third-party`

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(context.headers.get(header)!, headerValue)
      
      const { body: result1, status, header: headers } = await context.call<string>("get large bod", {
        url: thirdPartyEndpoint,
        method: "GET"
      })

      expect(input, payload);

      expect(status, 201)
      expect(result1, largeObject)
      expect(result1.length, largeObjectLength)
      expect(headers[GET_HEADER][0], GET_HEADER_VALUE)

      const result2 = await context.run("step2", () => {
        return result1.length
      });

      expect(result2, largeObjectLength);

      await saveResult(
        context,
        result2.toString()
      )
    }, {
      baseUrl: BASE_URL,
    }
  ), {
    expectedCallCount: 5,
    expectedResult: largeObjectLength.toString(),
    payload,
    headers: {
      [ header ]: headerValue
    },
    triggerConfig: {
      retries: 0
    }
  }
)
