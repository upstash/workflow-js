import { describe, test, expect } from "bun:test";
import {
  LazyCallStep,
  LazyFunctionStep,
  LazyNotifyStep,
  LazySleepStep,
  LazySleepUntilStep,
  LazyWaitForEventStep,
  LazyWaitForWebhookStep,
} from "./steps";
import { nanoid } from "../utils";
import type { NotifyResponse, NotifyStepResponse, Step } from "../types";
import { Client, FlowControl } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowError } from "../error";
import { WorkflowContext } from "./context";

// Helper to create a mock WorkflowContext for testing
const createMockContext = () => {
  const token = nanoid();
  const qstashClient = new Client({
    baseUrl: MOCK_QSTASH_SERVER_URL,
    token,
    enableTelemetry: false,
  });
  return new WorkflowContext({
    qstashClient,
    initialPayload: "test-payload",
    steps: [],
    url: WORKFLOW_ENDPOINT,
    headers: new Headers() as Headers,
    workflowRunId: "test-wfr-id",
  });
};

describe("test steps", () => {
  const stepName = nanoid();
  const concurrent = 10;
  const targetStep = 7;
  const stepId = 20;

  describe("function step", () => {
    const result = nanoid();
    const stepFunction = () => {
      return result;
    };
    const mockContext = createMockContext();
    const step = new LazyFunctionStep(mockContext, stepName, stepFunction);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("Run");
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "Run",
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      const resultStep: Step<string> = {
        stepId,
        stepName,
        stepType: "Run",
        out: result,
        concurrent: 9,
      };

      expect(await step.getResultStep(9, stepId)).toEqual(resultStep);
    });
  });

  describe("sleep step", () => {
    const sleepAmount = 123_123;
    const mockContext = createMockContext();
    const step = new LazySleepStep(mockContext, stepName, sleepAmount);

    const sleepWithDuration = "90s";
    const stepWithDuration = new LazySleepStep(mockContext, stepName, sleepWithDuration);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("SleepFor");
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "SleepFor",
        sleepFor: sleepAmount,
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      expect(await step.getResultStep(6, stepId)).toEqual({
        stepId,
        stepName,
        stepType: "SleepFor",
        sleepFor: sleepAmount, // adding sleepFor
        concurrent: 6,
      });
    });

    test("should create plan step with duration", () => {
      expect(stepWithDuration.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "SleepFor",
        sleepFor: sleepWithDuration,
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      expect(await stepWithDuration.getResultStep(6, stepId)).toEqual({
        stepId,
        stepName,
        stepType: "SleepFor",
        sleepFor: sleepWithDuration,
        concurrent: 6,
      });
    });
  });

  describe("sleepUntil step", () => {
    const sleepUntilTime = 123_123;
    const mockContext = createMockContext();
    const step = new LazySleepUntilStep(mockContext, stepName, sleepUntilTime);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("SleepUntil");
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "SleepUntil",
        sleepUntil: sleepUntilTime,
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      expect(await step.getResultStep(4, stepId)).toEqual({
        stepId,
        stepName,
        stepType: "SleepUntil",
        sleepUntil: sleepUntilTime, // adding sleepUntil
        concurrent: 4,
      });
    });
  });

  describe("call step", () => {
    const headerValue = nanoid();

    const callUrl = "https://www.website.com/api";
    const callMethod = "POST";
    const callBody = nanoid();
    const callHeaders = {
      "my-header": headerValue,
    };
    const flowControl: FlowControl = {
      key: "my-key",
      parallelism: 3,
    };
    const mockContext = createMockContext();
    const step = new LazyCallStep(
      mockContext,
      stepName,
      callUrl,
      callMethod,
      callBody,
      callHeaders,
      14,
      "1000",
      30,
      flowControl,
      true
    );

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("Call");
      expect(step.flowControl).toEqual(flowControl);
      expect(step.retries).toBe(14);
      expect(step.retryDelay).toBe("1000");
      expect(step.timeout).toBe(30);
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "Call",
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      expect(await step.getResultStep(4, stepId)).toEqual({
        callBody,
        callHeaders,
        callMethod,
        callUrl,
        concurrent: 4,
        stepId,
        stepName,
        stepType: "Call",
      });
    });
  });

  describe("wait step", () => {
    const eventId = "my-event-id";
    const timeout = "10s";
    const mockContext = createMockContext();
    const step = new LazyWaitForEventStep(mockContext, stepName, eventId, timeout);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("Wait");
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "Wait",
        waitEventId: eventId,
        timeout,
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      expect(await step.getResultStep(4, stepId)).toEqual({
        waitEventId: eventId,
        timeout,
        concurrent: 4,
        stepId,
        stepName,
        stepType: "Wait",
      });
    });
  });

  describe("notify step", () => {
    const eventId = "my-event-id";
    const eventData = { data: "my-event-data" };

    // get client
    const token = nanoid();
    const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });
    const mockContext = createMockContext();

    const step = new LazyNotifyStep(mockContext, stepName, eventId, eventData, client.http);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("Notify");
    });
    test("should create plan step", () => {
      expect(step.getPlanStep(concurrent, targetStep)).toEqual({
        stepId: 0,
        stepName,
        stepType: "Notify",
        concurrent,
        targetStep,
      });
    });

    test("should create result step", async () => {
      let called = false;
      const notifyResponse: NotifyResponse[] = [
        {
          error: "no-error",
          messageId: "msg-id",
          waiter: {
            deadline: 123,
            headers: {
              "my-header": ["value"],
            },
            timeoutBody: undefined,
            timeoutHeaders: {
              "my-header": ["value"],
            },
            timeoutUrl: "url",
            url: "url",
          },
        },
      ];
      const stepResponse: NotifyStepResponse = {
        eventId,
        eventData,
        notifyResponse,
      };

      await mockQStashServer({
        execute: async () => {
          const result = await step.getResultStep(4, stepId);
          expect(result).toEqual({
            concurrent: 4,
            stepId,
            out: stepResponse,
            stepName,
            stepType: "Notify",
          });
          called = true;
        },
        responseFields: {
          status: 200,
          body: notifyResponse,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/notify/${eventId}`,
          token,
          body: eventData,
        },
      });

      expect(called).toBeTrue();
    });
  });

  describe("stepName check", () => {
    test("should throw when step name is undefined", () => {
      const mockContext = createMockContext();
      // @ts-expect-error allow undefined for test purposes
      const throws = () => new LazySleepStep(mockContext, undefined, 10);
      expect(throws).toThrow(
        new WorkflowError(
          "A workflow step name cannot be undefined or an empty string. Please provide a name for your workflow step."
        )
      );
    });

    test("should throw when step name is empty string", () => {
      const mockContext = createMockContext();
      const throws = () => new LazyFunctionStep(mockContext, "", () => {});
      expect(throws).toThrow(
        new WorkflowError(
          "A workflow step name cannot be undefined or an empty string. Please provide a name for your workflow step."
        )
      );
    });

    test("should throw when step name isn't string", () => {
      const mockContext = createMockContext();
      // @ts-expect-error passing number for test purposes
      const throws = () => new LazyFunctionStep(mockContext, 1, () => {});
      expect(throws).toThrow(new WorkflowError('A workflow step name must be a string. Received "1" (number).'));
    });
  });

  describe("parseOut tests", () => {
    const mockContext = createMockContext();

    describe("LazyFunctionStep parseOut", () => {
      test("should parse string result", () => {
        const step = new LazyFunctionStep(mockContext, "test-step", () => "result");
        const stepResult: Step<string> = {
          stepId: 1,
          stepName: "test-step",
          stepType: "Run",
          out: '"result"',
          concurrent: 1,
        };
        expect(step.parseOut(stepResult)).toBe("result");
      });

      test("should parse object result", () => {
        const resultObj = { key: "value", nested: { field: 123 } };
        const step = new LazyFunctionStep(mockContext, "test-step", () => resultObj);
        const stepResult: Step = {
          stepId: 1,
          stepName: "test-step",
          stepType: "Run",
          out: JSON.stringify(resultObj),
          concurrent: 1,
        };
        expect(step.parseOut(stepResult)).toEqual(resultObj);
      });

      test("should handle undefined out", () => {
        const step = new LazyFunctionStep(mockContext, "test-step", () => undefined);
        const stepResult: Step = {
          stepId: 1,
          stepName: "test-step",
          stepType: "Run",
          out: undefined,
          concurrent: 1,
        };
        expect(step.parseOut(stepResult)).toBeUndefined();
      });
    });

    describe("LazySleepStep parseOut", () => {
      test("should handle undefined out for sleep step", () => {
        const step = new LazySleepStep(mockContext, "sleep-step", 10);
        const stepResult: Step = {
          stepId: 1,
          stepName: "sleep-step",
          stepType: "SleepFor",
          sleepFor: 10,
          concurrent: 1,
          out: undefined,
        };
        expect(step.parseOut(stepResult)).toBeUndefined();
      });
    });

    describe("LazySleepUntilStep parseOut", () => {
      test("should return undefined for sleepUntil step", () => {
        const step = new LazySleepUntilStep(mockContext, "sleep-until-step", 123456);
        const stepResult: Step = {
          stepId: 1,
          stepName: "sleep-until-step",
          stepType: "SleepUntil",
          sleepUntil: 123456,
          concurrent: 1,
          out: undefined,
        };
        expect(step.parseOut(stepResult)).toBeUndefined();
      });
    });

    describe("LazyCallStep parseOut", () => {
      test("should parse successful call response with JSON body", () => {
        const step = new LazyCallStep(
          mockContext,
          "call-step",
          "https://api.example.com",
          "POST",
          { data: "test" },
          {},
          0,
          undefined,
          undefined,
          undefined,
          true
        );

        const responseBody = { message: "success", id: 123 };
        const stepResult: Step = {
          stepId: 1,
          stepName: "call-step",
          stepType: "Call",
          out: JSON.stringify({
            header: { "content-type": ["application/json"] },
            status: 200,
            body: JSON.stringify(responseBody),
          }),
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.status).toBe(200);
        expect(result.body).toEqual(responseBody);
        expect(result.header["content-type"]).toEqual(["application/json"]);
      });

      test("should parse call response with non-JSON text body", () => {
        const step = new LazyCallStep(
          mockContext,
          "call-step",
          "https://api.example.com",
          "GET",
          undefined,
          {},
          0,
          undefined,
          undefined,
          undefined,
          true
        );

        const textBody = "plain text response";
        const stepResult: Step = {
          stepId: 1,
          stepName: "call-step",
          stepType: "Call",
          out: JSON.stringify({
            header: { "content-type": ["text/plain"] },
            status: 200,
            body: textBody,
          }),
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.status).toBe(200);
        expect(result.body).toBe(textBody);
      });

      test("should parse call response with binary body", () => {
        const step = new LazyCallStep(
          mockContext,
          "call-step",
          "https://api.example.com",
          "GET",
          undefined,
          {},
          0,
          undefined,
          undefined,
          undefined,
          true
        );

        const binaryBody = "binary-data";
        const stepResult: Step = {
          stepId: 1,
          stepName: "call-step",
          stepType: "Call",
          out: JSON.stringify({
            header: { "content-type": ["application/octet-stream"] },
            status: 200,
            body: binaryBody,
          }),
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.status).toBe(200);
        expect(result.body).toBe(binaryBody);
      });

      test("should handle error status codes", () => {
        const step = new LazyCallStep(
          mockContext,
          "call-step",
          "https://api.example.com",
          "POST",
          {},
          {},
          0,
          undefined,
          undefined,
          undefined,
          true
        );

        const errorBody = { error: "Not Found" };
        const stepResult: Step = {
          stepId: 1,
          stepName: "call-step",
          stepType: "Call",
          out: JSON.stringify({
            header: { "content-type": ["application/json"] },
            status: 404,
            body: JSON.stringify(errorBody),
          }),
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.status).toBe(404);
        expect(result.body).toEqual(errorBody);
      });
    });

    describe("LazyWaitForEventStep parseOut", () => {
      test("should parse wait event response with event data", () => {
        const eventData = { userId: "123", action: "completed" };
        const step = new LazyWaitForEventStep(mockContext, "wait-step", "event-id", "10s");

        const encodedData = btoa(JSON.stringify(eventData));

        const stepResult: Step = {
          stepId: 1,
          stepName: "wait-step",
          stepType: "Wait",
          out: encodedData,
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.eventData).toEqual(eventData);
        expect(result.timeout).toBe(false);
      });

      test("should parse wait event response with timeout", () => {
        const step = new LazyWaitForEventStep(mockContext, "wait-step", "event-id", "10s");

        const stepResult: Step = {
          stepId: 1,
          stepName: "wait-step",
          stepType: "Wait",
          out: undefined,
          concurrent: 1,
          waitTimeout: true,
          timeout: "30s",
          waitEventId: "event-id",
        };

        const result = step.parseOut(stepResult);
        expect(result.eventData).toBeUndefined();
        expect(result.timeout).toBe(true);
      });
    });

    describe("LazyNotifyStep parseOut", () => {
      test("should parse notify step response", () => {
        const eventId = "event-123";
        const eventData = { message: "notification data" };
        const notifyResponse: NotifyResponse[] = [
          {
            error: "",
            messageId: "msg-123",
            waiter: {
              deadline: 123456,
              headers: { "x-custom": ["value"] },
              timeoutBody: undefined,
              timeoutHeaders: {},
              timeoutUrl: "https://timeout.url",
              url: "https://waiter.url",
            },
          },
        ];

        const token = nanoid();
        const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });
        const step = new LazyNotifyStep(
          mockContext,
          "notify-step",
          eventId,
          eventData,
          client.http
        );

        const stepResponse: NotifyStepResponse = {
          eventId,
          eventData,
          notifyResponse,
        };

        const stepResult: Step = {
          stepId: 1,
          stepName: "notify-step",
          stepType: "Notify",
          out: JSON.stringify(stepResponse),
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.eventId).toBe(eventId);
        expect(result.eventData).toEqual(eventData);
        expect(result.notifyResponse).toEqual(notifyResponse);
      });
    });

    describe("LazyWaitForWebhookStep parseOut", () => {
      test("should parse webhook wait response with request data", () => {
        const webhook = {
          webhookUrl: "https://qstash.upstash.io/v2/workflows/hooks/user/wfr/evt",
          eventId: "evt-123",
        };
        const step = new LazyWaitForWebhookStep(mockContext, "wait-webhook-step", webhook, "30s");

        const requestData = {
          method: "POST" as const,
          header: {
            "content-type": ["application/json"],
            "x-custom": ["value"],
          },
          body: btoa(JSON.stringify({ payload: "data" })),
          proto: "https",
          host: "example.com",
          url: "/api/endpoint",
        };

        const encodedData = btoa(JSON.stringify(requestData));

        const stepResult: Step = {
          stepId: 1,
          stepName: "wait-webhook-step",
          stepType: "WaitForWebhook",
          out: encodedData,
          concurrent: 1,
        };

        const result = step.parseOut(stepResult);
        expect(result.timeout).toBe(false);
        expect(result.request).toBeInstanceOf(Request);
        expect(result.request && result.request.method).toBe("POST");
        expect(result.request && result.request.url).toBe("https://example.com/api/endpoint");
      });

      test("should parse webhook wait response with timeout", () => {
        const webhook = {
          webhookUrl: "https://qstash.upstash.io/v2/workflows/hooks/user/wfr/evt",
          eventId: "evt-123",
        };
        const step = new LazyWaitForWebhookStep(mockContext, "wait-webhook-step", webhook, "30s");

        const stepResult: Step = {
          stepId: 1,
          stepName: "wait-webhook-step",
          stepType: "WaitForWebhook",
          out: undefined,
          concurrent: 1,
          waitTimeout: true,
          timeout: "30s",
          waitEventId: "evt-123",
        };

        const result = step.parseOut(stepResult);
        expect(result.request).toBeUndefined();
        expect(result.timeout).toBe(true);
      });
    });
  });
});
