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
  expectedStatus: number,
  expectedBody: unknown
) => {
  const randomId = context.headers.get(CI_RANDOM_ID_HEADER)
  const route = context.headers.get(CI_ROUTE_HEADER)

  if (!randomId || !route) {
    throw new Error("randomId or route not found")
  }

  const { status, body } = await context.call<FailureFunctionPayload>(stepName, {
    url: thirdPartyEndpoint,
    body: 
    {
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
      "Upstash-Workflow-Is-Failure": "true"
    }
  })

  expect(status, expectedStatus)
  console.log("BODE", JSON.stringify(body));
  
  expect(typeof body, typeof expectedBody)
  expect(JSON.stringify(body), JSON.stringify(expectedBody))
}

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {

      expect(context.headers.get(header)!, headerValue)
      
      await makeCall(
        context,
        "regular call should fail",
        "POST",
        500,
        {
          error: "WorkflowError",
          message: "Not authorized to run the failure function."
        }
      )
      
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
    expectedCallCount: 4,
    expectedResult: "not authorized for failure",
    payload,
    headers: {
      [ header ]: headerValue,
      "authentication": authentication
    }
  }
) 