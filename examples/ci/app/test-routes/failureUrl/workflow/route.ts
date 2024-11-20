import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { ERROR_MESSAGE, PAYLOAD, HEADER, HEADER_VALUE } from "../constants";

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/failureUrl/third-party`

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, PAYLOAD);
      expect(context.headers.get(HEADER)!, HEADER_VALUE)

      await context.run("step1", () => {
        throw new Error(ERROR_MESSAGE);
      });
    }, {
      baseUrl: BASE_URL,
      retries: 0,
      failureUrl: thirdPartyEndpoint
    }
  ), {
    expectedCallCount: 2,
    expectedResult: `{"error":"Error","message":"${ERROR_MESSAGE}"}`,
    payload: PAYLOAD,
    headers: {
      [ HEADER ]: HEADER_VALUE,
    }
  }
) 