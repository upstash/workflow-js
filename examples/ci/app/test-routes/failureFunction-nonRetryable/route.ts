import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, WORKFLOW_LABEL_HEADER } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"
import { WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";

const header = `test-header-foo`
const headerValue = `header-bar`
const authHeaderValue = `Bearer super-secret-token`

const errorMessage = `my-non-retryable-error`
const payload = "my-payload"
const label = "my-non-retryable-label"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(typeof input, typeof payload);
      expect(input, payload);
      expect(context.headers.get(header)!, headerValue)
      expect(context.headers.get(WORKFLOW_LABEL_HEADER)!, label)
      expect(context.label, label)

      await context.run("step1", () => {
        throw new WorkflowNonRetryableError(errorMessage);
      });
    }, {
      baseUrl: BASE_URL,
      failureFunction: async ({ context, failStatus, failResponse }) => {
        expect(failStatus, 489);
        expect(failResponse, errorMessage);
        expect(context.requestPayload, payload);
        expect(typeof context.requestPayload, typeof payload);
        expect(context.headers.get("authentication")!, authHeaderValue);
        expect(context.headers.get(WORKFLOW_LABEL_HEADER)!, label)
        expect(context.label, label)

        await saveResult(
          context as WorkflowContext,
          failResponse
        )
      },
    }
  ), {
    expectedCallCount: 2,
    expectedResult: errorMessage,
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authHeaderValue,
    },
    triggerConfig: {
      retries: 0,
      label
    }
  }
)
