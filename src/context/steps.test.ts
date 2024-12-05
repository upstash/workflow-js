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
import { Client } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { WorkflowError } from "../error";

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
    const step = new LazyFunctionStep(stepName, stepFunction);

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
    const step = new LazySleepStep(stepName, sleepAmount);

    const sleepWithDuration = "90s";
    const stepWithDuration = new LazySleepStep(stepName, sleepWithDuration);

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
    const step = new LazySleepUntilStep(stepName, sleepUntilTime);

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
    const step = new LazyCallStep(stepName, callUrl, callMethod, callBody, callHeaders, 14, 30);

    test("should set correct fields", () => {
      expect(step.stepName).toBe(stepName);
      expect(step.stepType).toBe("Call");
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
    const step = new LazyWaitForEventStep(stepName, eventId, timeout);

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

    const step = new LazyNotifyStep(stepName, eventId, eventData, client.http);

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
    test("should throw when step name is undefined ", () => {
      // @ts-expect-error allow undefined for test purposes
      const throws = () => new LazySleepStep(undefined, 10);
      expect(throws).toThrow(
        new WorkflowError(
          "A workflow step name cannot be undefined or an empty string. Please provide a name for your workflow step."
        )
      );
    });

    test("should throw when step name is empty string ", () => {
      const throws = () => new LazyFunctionStep("", () => {});
      expect(throws).toThrow(
        new WorkflowError(
          "A workflow step name cannot be undefined or an empty string. Please provide a name for your workflow step."
        )
      );
    });
  });
});
