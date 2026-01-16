import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { fail, saveResult } from "app/ci/upstash/redis"
import { FAILING_HEADER, FAILING_HEADER_VALUE, PATCH_RESULT } from "../constants";
import { WorkflowContext } from "@upstash/workflow";

const testHeader = `test-header-foo`
const headerValue = `header-foo`
const payload = "my-payload"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/call/third-party`

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      const { body: patchResult, status, header } = await context.call<number>("get call", {
        url: thirdPartyEndpoint,
        method: "PATCH",
        retries: 0
      });

      expect(status, 401)
      expect(patchResult, PATCH_RESULT);
      expect(header[FAILING_HEADER][0], FAILING_HEADER_VALUE)
      
      await saveResult(
        context,
        patchResult.toString(),
      )
    }, {
      baseUrl: BASE_URL,
      async failureFunction({ context }) {
        await fail(context as WorkflowContext)
      },
    }
  ), {
    expectedCallCount: 3,
    expectedResult: PATCH_RESULT.toString(),
    payload,
    headers: {
      [ testHeader ]: headerValue,
    },
    triggerConfig: {
      retries: 0,
    }
  }
) 