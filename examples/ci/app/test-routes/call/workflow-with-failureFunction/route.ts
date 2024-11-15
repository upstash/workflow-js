import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { FAILING_HEADER, FAILING_HEADER_VALUE } from "../constants";

const testHeader = `test-header-foo`
const headerValue = `header-foo`
const payload = "my-payload"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/call/third-party`

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const { body: patchResult, status, header } = await context.call("get call", {
        url: thirdPartyEndpoint,
        method: "PATCH",
        retries: 0
      });

      expect(status, 401)
      expect(patchResult as string, "failing request");
      expect(header[FAILING_HEADER][0], FAILING_HEADER_VALUE)
      
      await saveResult(
        context,
        patchResult as string,
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0,
      failureFunction() {
        console.log("SHOULDNT RUN");
      },
    }
  ), {
    expectedCallCount: 4,
    expectedResult: "failing request",
    payload,
    headers: {
      [ testHeader ]: headerValue,
    }
  }
) 