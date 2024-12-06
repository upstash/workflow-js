import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { FailureFunctionPayload, WorkflowContext } from "@upstash/workflow";
import { saveResult } from "app/ci/upstash/redis";

const header = `test-header-foo`
const headerValue = `header-bar`
const authentication = `Bearer test-auth-super-secret`
const payload = "my-payload"

const thirdPartyEndpoint = `${TEST_ROUTE_PREFIX}/auth/custom/target`

const makeCall = async (
  context: WorkflowContext,
  stepName: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  expectedStatus: number,
  expectedBody: unknown,
  callBody?: unknown
) => {
  const randomId = context.headers.get(CI_RANDOM_ID_HEADER)
  const route = context.headers.get(CI_ROUTE_HEADER)

  if (!randomId || !route) {
    throw new Error("randomId or route not found")
  }

  const { status, body } = await context.call<FailureFunctionPayload>(stepName, {
    url: thirdPartyEndpoint,
    body: callBody ?? {
      status: 200,
      header: "",
      body: "",
      url: "",
      sourceHeader: {
        [CI_ROUTE_HEADER]: [route],
        [CI_RANDOM_ID_HEADER]: [randomId]
      },
      sourceBody: "",
      workflowRunId: "",
      sourceMessageId: "",
    },
    method,
    headers: {
      [ CI_RANDOM_ID_HEADER ]: randomId,
      [ CI_ROUTE_HEADER ]: route,
      ...headers
    }
  })

  expect(status, expectedStatus)
  
  expect(typeof body, typeof expectedBody)
  expect(JSON.stringify(body), JSON.stringify(expectedBody))
}

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      expect(context.headers.get(header)!, headerValue)
      
      await makeCall(
        context,
        "failure call should fail",
        "POST",
        {
          "Upstash-Workflow-Is-Failure": "true"
        },
        500,
        {
          error: "WorkflowError",
          message: "Not authorized to run the failure function."
        }
      )
      
      await makeCall(
        context,
        "callback request should fail",
        "POST",
        {
          "Upstash-Workflow-Callback": "true",
        },
        400,
        {
          message: "Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run",
          workflowRunId: "no-workflow-id"
        }
      )
      
      await makeCall(
        context,
        "init call should fail",
        "POST",
        {},
        400,
        {
          message: "Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run",
          workflowRunId: "no-workflow-id"
        }
      )
      
      // TODO: enable back
      // was disabled because Upstash-Workflow-RunId header is being overwritten by backend with the current workflow
      // await makeCall(
      //   context,
      //   "intermediate call should fail",
      //   "POST",
      //   {
      //     "Upstash-Workflow-Sdk-Version": "1",
      //     "Upstash-Workflow-RunId": customRunId
      //   },
      //   400,
      //   {
      //     message: "Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run",
      //     workflowRunId: customRunId
      //   },
      //   [{
      //     body: btoa("hello there"),
      //     callType: "step"
      //   }]
      // )
      
      const input = context.requestPayload;
      expect(input, payload);

      await saveResult(
        context,
        "not authorized for failure"
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0,
    }
  ), {
    expectedCallCount: 8,
    expectedResult: "not authorized for failure",
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authentication
    }
  }
) 