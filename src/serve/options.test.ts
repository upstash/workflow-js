/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, test } from "bun:test";
import { Client } from "@upstash/qstash";
import { nanoid } from "nanoid";
import {
  MOCK_QSTASH_SERVER_URL,
  WORKFLOW_ENDPOINT,
  mockQStashServer,
  getRequest,
  ResponseFields,
  RequestFields,
} from "../test-utils";
import { WorkflowNonRetryableError, WorkflowRetryAfterError } from "../error";
import { serve } from "./index";
import { createResponseData, AUTH_FAIL_MESSAGE } from "./options";
import {
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_ID_HEADER,
} from "../constants";
import { DetailedFinishCondition, RouteFunction, WorkflowServeOptions } from "../types";

const token = nanoid();
const qstashClient = new Client({
  baseUrl: MOCK_QSTASH_SERVER_URL,
  token,
  enableTelemetry: false,
});

/**
 * Utility function to test createResponseData both directly and through serve endpoint
 */
const testResponseDataCase = <TInitialPayload = unknown, TResult = unknown>({
  testName,
  expectedResponseData,
  detailedFinishCondition,
  routeFunction,
  serveOptions,
  request,
  mockQStashParams,
}: {
  testName: string;
  expectedResponseData: {
    status: number;
    headers: Record<string, string>;
    body: unknown; // Use parsed object directly to support matchers
  };
  detailedFinishCondition: {
    workflowRunId: string;
    condition: DetailedFinishCondition;
  };
  routeFunction: RouteFunction<TInitialPayload, TResult>;
  serveOptions: WorkflowServeOptions<TInitialPayload, TResult>;
  request: Request;
  mockQStashParams: {
    responseFields: ResponseFields;
    receivesRequest: RequestFields | false;
  };
}) => {
  describe(testName, () => {
    test("should return correct ResponseData from createResponseData", () => {
      const result = createResponseData(
        detailedFinishCondition.workflowRunId,
        detailedFinishCondition.condition
      );

      expect(result.status).toBe(expectedResponseData.status);
      expect(result.headers).toEqual(expectedResponseData.headers);

      // Parse and compare with proper matchers
      const resultParsed = JSON.parse(result.text);
      expect(resultParsed).toEqual(expectedResponseData.body);
    });

    test("should return correct response from serve endpoint", async () => {
      const { handler: endpoint } = serve<TInitialPayload, Request, Response, TResult>(
        routeFunction,
        serveOptions
      );

      let called = false;
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          expect(response.status).toBe(expectedResponseData.status);

          // Check headers
          for (const [key, value] of Object.entries(expectedResponseData.headers)) {
            expect(response.headers.get(key)).toBe(value);
          }

          // Check body with proper matchers
          const body = await response.json();
          expect(body).toEqual(expectedResponseData.body);

          called = true;
        },
        responseFields: mockQStashParams.responseFields,
        receivesRequest: mockQStashParams.receivesRequest,
      });
      expect(called).toBeTrue();
    });
  });
};

describe("createResponseData", () => {
  describe("auth-fail condition", () => {
    const workflowRunId = "wfr-auth-fail";

    testResponseDataCase({
      testName: "auth-fail",
      expectedResponseData: {
        status: 400,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          message: AUTH_FAIL_MESSAGE,
          workflowRunId,
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: { condition: "auth-fail" },
      },
      routeFunction: async (_context) => {
        // Return early to trigger auth-fail
        return;
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
      },
      request: getRequest(WORKFLOW_ENDPOINT, workflowRunId, "my-payload", []),
      mockQStashParams: {
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: false,
      },
    });
  });

  describe("non-retryable-error condition", () => {
    const workflowRunId = "wfr-non-retryable";
    const errorMessage = "This is a non-retryable error";
    const error = new WorkflowNonRetryableError(errorMessage);

    testResponseDataCase({
      testName: "non-retryable-error",
      expectedResponseData: {
        status: 489,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Upstash-NonRetryable-Error": "true",
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          error: "WorkflowNonRetryableError",
          message: errorMessage,
          stack: expect.any(String),
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: { condition: "non-retryable-error", result: error },
      },
      routeFunction: async (_context) => {
        throw new WorkflowNonRetryableError(errorMessage);
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
      },
      request: getRequest(WORKFLOW_ENDPOINT, workflowRunId, "my-payload", []),
      mockQStashParams: {
        responseFields: { body: undefined, status: 489 },
        receivesRequest: false,
      },
    });
  });

  describe("retry-after-error condition", () => {
    const workflowRunId = "wfr-retry-after";
    const errorMessage = "This is a retry-after error";
    const retryAfter = 30;
    const error = new WorkflowRetryAfterError(errorMessage, retryAfter);

    testResponseDataCase({
      testName: "retry-after-error",
      expectedResponseData: {
        status: 429,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Retry-After": retryAfter.toString(),
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          error: "WorkflowRetryAfterError",
          message: errorMessage,
          stack: expect.any(String),
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: { condition: "retry-after-error", result: error },
      },
      routeFunction: async (_context) => {
        throw new WorkflowRetryAfterError(errorMessage, retryAfter);
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
      },
      request: getRequest(WORKFLOW_ENDPOINT, workflowRunId, "my-payload", []),
      mockQStashParams: {
        responseFields: { body: undefined, status: 429 },
        receivesRequest: false,
      },
    });
  });

  describe("failure-callback-executed condition", () => {
    const workflowRunId = "wfr-failure-callback";
    const initialPayload = "initial-payload";

    // Helper to create failure callback request body
    const createFailureRequestBody = (errorMessage: string) => {
      return JSON.stringify({
        status: 500,
        header: {},
        body: btoa(JSON.stringify({ message: errorMessage, stack: "stack-trace" })),
        url: WORKFLOW_ENDPOINT,
        sourceBody: btoa(initialPayload),
        workflowRunId,
        sourceMessageId: "msg-id",
      });
    };

    const failureFunctionResult = { success: true, data: "callback-result" };

    testResponseDataCase({
      testName: "failure-callback-executed with result object",
      expectedResponseData: {
        status: 200,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          result: JSON.stringify(failureFunctionResult),
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: {
          condition: "failure-callback-executed",
          result: JSON.stringify(failureFunctionResult),
        },
      },
      routeFunction: async (context) => {
        await context.run("step1", () => "some result");
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
        failureFunction: async ({ context, failStatus, failResponse }) => {
          return JSON.stringify(failureFunctionResult);
        },
      },
      request: new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: createFailureRequestBody("workflow failed"),
        headers: {
          [WORKFLOW_FAILURE_HEADER]: "true",
          [WORKFLOW_ID_HEADER]: workflowRunId,
        },
      }),
      mockQStashParams: {
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: false,
      },
    });

    testResponseDataCase({
      testName: "failure-callback-executed with no return value",
      expectedResponseData: {
        status: 200,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          result: undefined,
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: {
          condition: "failure-callback-executed",
          result: undefined,
        },
      },
      routeFunction: async (context) => {
        await context.run("step1", () => "some result");
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
        failureFunction: async ({ context, failStatus, failResponse }) => {
          // No return statement
        },
      },
      request: new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: createFailureRequestBody("workflow failed"),
        headers: {
          [WORKFLOW_FAILURE_HEADER]: "true",
          [WORKFLOW_ID_HEADER]: workflowRunId,
        },
      }),
      mockQStashParams: {
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: false,
      },
    });

    test("should return correct ResponseData from createResponseData with result", () => {
      const callbackResult = "callback-result";
      const result = createResponseData(workflowRunId, {
        condition: "failure-callback-executed",
        result: callbackResult,
      });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(JSON.stringify({ result: callbackResult }));
    });

    test("should handle undefined result in failure-callback-executed", () => {
      const result = createResponseData(workflowRunId, {
        condition: "failure-callback-executed",
        result: undefined,
      });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(JSON.stringify({ result: undefined }));
    });
  });

  describe("failure-callback-undefined condition", () => {
    const workflowRunId = "wfr-failure-undefined";
    const initialPayload = "initial-payload";

    // Helper to create failure callback request body
    const createFailureRequestBody = (errorMessage: string) => {
      return JSON.stringify({
        status: 500,
        header: {},
        body: btoa(JSON.stringify({ message: errorMessage, stack: "stack-trace" })),
        url: WORKFLOW_ENDPOINT,
        sourceBody: btoa(initialPayload),
        workflowRunId,
        sourceMessageId: "msg-id",
      });
    };

    testResponseDataCase({
      testName: "failure-callback-undefined when failureFunction not provided",
      expectedResponseData: {
        status: 200,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          "Upstash-Workflow-Failure-Callback-Notfound": "true",
          "Upstash-workflow-sdk": "v1.0.0",
        },
        body: {
          // when handleFailure is working, endpoint consideers the request as new invocation.
          // this means it generates a random workflowRunId instead of using the passed one
          workflowRunId: expect.any(String),
          finishCondition: "failure-callback-undefined",
        },
      },
      detailedFinishCondition: {
        workflowRunId,
        condition: { condition: "failure-callback-undefined" },
      },
      routeFunction: async (context) => {
        await context.run("step1", () => "some result");
      },
      serveOptions: {
        qstashClient,
        receiver: undefined,
        // No failureFunction defined
      },
      request: new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: createFailureRequestBody("workflow failed"),
        headers: {
          [WORKFLOW_FAILURE_HEADER]: "true",
          [WORKFLOW_ID_HEADER]: workflowRunId,
        },
      }),
      mockQStashParams: {
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: false,
      },
    });

    test("should return correct ResponseData from createResponseData", () => {
      const result = createResponseData(workflowRunId, {
        condition: "failure-callback-undefined",
      });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-Workflow-Failure-Callback-Notfound": "true",
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(
        JSON.stringify({
          workflowRunId,
          finishCondition: "failure-callback-undefined",
        })
      );
    });
  });

  describe("success conditions", () => {
    const workflowRunId = "wfr-success";

    test("should handle success condition", () => {
      const result = createResponseData(workflowRunId, { condition: "success" });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(
        JSON.stringify({
          workflowRunId,
          finishCondition: "success",
        })
      );
    });

    test("should handle duplicate-step condition", () => {
      const result = createResponseData(workflowRunId, { condition: "duplicate-step" });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(
        JSON.stringify({
          workflowRunId,
          finishCondition: "duplicate-step",
        })
      );
    });

    test("should handle workflow-already-ended condition", () => {
      const result = createResponseData(workflowRunId, { condition: "workflow-already-ended" });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(
        JSON.stringify({
          workflowRunId,
          finishCondition: "workflow-already-ended",
        })
      );
    });

    test("should handle fromCallback condition", () => {
      const result = createResponseData(workflowRunId, { condition: "fromCallback" });

      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-workflow-sdk": "v1.0.0",
      });
      expect(result.text).toBe(
        JSON.stringify({
          workflowRunId,
          finishCondition: "fromCallback",
        })
      );
    });
  });
});
