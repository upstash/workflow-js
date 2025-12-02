import { describe, test, expect } from "bun:test";
import {
  LazyCallStep,
  LazyFunctionStep,
  LazyNotifyStep,
  LazySleepStep,
  LazySleepUntilStep,
  LazyWaitForEventStep,
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

    // will be enabled when the string check in BaseLazyStep constructor is updated
    test.skip("should throw when step name isn't string", () => {
      const mockContext = createMockContext();
      // @ts-expect-error passing number for test purposes
      const throws = () => new LazyFunctionStep(mockContext, 1, () => {});
      expect(throws).toThrow(new WorkflowError("A workflow step name must be a string."));
    });
  });
});
