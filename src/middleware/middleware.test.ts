import { describe, test, expect, jest } from "bun:test";
import { WorkflowMiddleware } from "./middleware";
import { Client } from "@upstash/qstash";
import { getRequest } from "../test-utils";
import { nanoid } from "../utils";
import { serve } from "../../platforms/nextjs";
import { RouteFunction, Step } from "../types";

const createLoggingMiddleware = () => {
  const accumulator: [string, unknown?][] = [];
  const middleware = new WorkflowMiddleware({
    name: "test",
    init: () => {
      accumulator.push(["init"]);

      return {
        afterExecution(params) {
          accumulator.push(["afterExecution", params]);
        },
        beforeExecution(params) {
          accumulator.push(["beforeExecution", params]);
        },
        runStarted(params) {
          accumulator.push(["runStarted", params]);
        },
        runCompleted(params) {
          accumulator.push(["runCompleted", params]);
        },
        onError(params) {
          accumulator.push(["onError", params]);
        },
      };
    },
  });

  return { middleware, accumulator };
};

describe("middleware", () => {
  test("should not call init in constructor", () => {
    const init = jest.fn();
    new WorkflowMiddleware({ name: "test", init });
    expect(init).not.toHaveBeenCalled();
  });

  describe("runCallback method", () => {
    test("should call init and callbacks", async () => {
      const { middleware, accumulator } = createLoggingMiddleware();
      const stepName = `step-${nanoid()}`;

      await middleware.runCallback("runStarted", { workflowRunId: "wfr-id" });
      expect(accumulator).toEqual([["init"], ["runStarted", { workflowRunId: "wfr-id" }]]);

      await middleware.runCallback("beforeExecution", {
        workflowRunId: "wfr-id",
        stepName: stepName,
      });
      expect(accumulator).toEqual([
        ["init"],
        ["runStarted", { workflowRunId: "wfr-id" }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
      ]);

      await middleware.runCallback("beforeExecution", {
        workflowRunId: "wfr-id",
        stepName: stepName,
      });
      expect(accumulator).toEqual([
        ["init"],
        ["runStarted", { workflowRunId: "wfr-id" }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
      ]);

      await middleware.runCallback("afterExecution", {
        workflowRunId: "wfr-id",
        stepName: stepName,
      });
      expect(accumulator).toEqual([
        ["init"],
        ["runStarted", { workflowRunId: "wfr-id" }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
        ["afterExecution", { workflowRunId: "wfr-id", stepName }],
      ]);

      await middleware.runCallback("runCompleted", {
        workflowRunId: "wfr-id",
      });
      expect(accumulator).toEqual([
        ["init"],
        ["runStarted", { workflowRunId: "wfr-id" }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
        ["beforeExecution", { workflowRunId: "wfr-id", stepName }],
        ["afterExecution", { workflowRunId: "wfr-id", stepName }],
        ["runCompleted", { workflowRunId: "wfr-id" }],
      ]);
    });

    describe("with context", () => {
      const stepOneName = `step-one-${nanoid()}`;
      const stepTwoName = `step-two-${nanoid()}`;
      const stepThreeName = `step-three-${nanoid()}`;
      const parallelRunOne = `parallel-sleep-One-${nanoid()}`;
      const parallelRunTwo = `parallel-sleep-Two-${nanoid()}`;
      const stepResult = `step-result-${nanoid()}`;
      const stepResultOne = `step-result-one-${nanoid()}`;
      const stepResultTwo = `step-result-two-${nanoid()}`;

      const incrementalTestSteps: {
        step?: Step;
        middlewareAccumaltor: ReturnType<typeof createLoggingMiddleware>["accumulator"];
      }[] = [
        {
          middlewareAccumaltor: [
            ["init"],
            [
              "runStarted",
              {
                workflowRunId: "wfr-id",
              },
            ],
            [
              "beforeExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepOneName,
              },
            ],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepOneName,
              },
            ],
          ],
        },
        {
          step: {
            stepId: 1,
            stepName: stepOneName,
            stepType: "SleepFor",
            sleepFor: 1,
            concurrent: 1,
          },
          middlewareAccumaltor: [
            ["init"],
            [
              "beforeExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepTwoName,
              },
            ],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepTwoName,
              },
            ],
          ],
        },
        {
          step: {
            stepId: 2,
            stepName: stepTwoName,
            stepType: "Run",
            out: JSON.stringify(stepResult),
            concurrent: 1,
          },
          middlewareAccumaltor: [],
        },
        {
          step: {
            stepId: 0,
            stepName: parallelRunOne,
            stepType: "Run",
            concurrent: 2,
            targetStep: 3,
          },
          middlewareAccumaltor: [
            ["init"],
            [
              "beforeExecution",
              {
                workflowRunId: "wfr-id",
                stepName: parallelRunOne,
              },
            ],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: parallelRunOne,
              },
            ],
          ],
        },
        {
          step: {
            stepId: 0,
            stepName: parallelRunTwo,
            stepType: "Run",
            concurrent: 2,
            targetStep: 4,
          },
          middlewareAccumaltor: [
            ["init"],
            [
              "beforeExecution",
              {
                workflowRunId: "wfr-id",
                stepName: parallelRunTwo,
              },
            ],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: parallelRunTwo,
              },
            ],
          ],
        },
        {
          step: {
            stepId: 4,
            stepName: parallelRunTwo,
            stepType: "Run",
            out: JSON.stringify(stepResultTwo),
            concurrent: 2,
          },
          middlewareAccumaltor: [],
        },
        {
          step: {
            stepId: 3,
            stepName: parallelRunOne,
            stepType: "Run",
            out: JSON.stringify(stepResultOne),
            concurrent: 2,
          },
          middlewareAccumaltor: [
            ["init"],
            [
              "beforeExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepThreeName,
              },
            ],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepThreeName,
              },
            ],
          ],
        },
        {
          step: {
            stepId: 5,
            stepName: stepThreeName,
            stepType: "SleepFor",
            sleepFor: 10,
            concurrent: 1,
          },
          middlewareAccumaltor: [
            ["init"],
            [
              "runCompleted",
              {
                workflowRunId: "wfr-id",
              },
            ],
          ],
        },
      ];

      const routeFunction: RouteFunction<unknown> = async (context) => {
        await context.sleep(stepOneName, 1);
        await context.run(stepTwoName, () => stepResult);
        await Promise.all([
          context.run(parallelRunOne, () => stepResultOne),
          context.run(parallelRunTwo, () => stepResultTwo),
        ]);
        await context.sleep(stepThreeName, 10);
      };

      const qstashClient = new Client({ baseUrl: "https://requestcatcher.com", token: "token" });
      qstashClient.http.request = jest.fn();

      const runMiddlewareTest = async (
        steps: Step[],
        expectedAccumulator: ReturnType<typeof createLoggingMiddleware>["accumulator"],
        status: number = 200
      ) => {
        const { middleware, accumulator } = createLoggingMiddleware();

        const request = getRequest("https://requestcatcher.com", "wfr-id", undefined, steps);

        const { POST: handler } = serve(routeFunction, {
          middlewares: [middleware],
          url: "https://requestcatcher.com",
          receiver: undefined,
          qstashClient,
        });

        const response = await handler(request);
        expect(response.status).toBe(status);

        expect(accumulator).toEqual(expectedAccumulator);
      };

      incrementalTestSteps.forEach(({ middlewareAccumaltor }, index) => {
        const testSteps = incrementalTestSteps
          .slice(0, index + 1)
          .map(({ step }) => step)
          .filter(Boolean) as Step[];
        test(`should call middleware in order case #${index + 1}`, async () => {
          await runMiddlewareTest(testSteps, middlewareAccumaltor);
        });
      });

      test("with error", async () => {
        await runMiddlewareTest(
          [
            {
              stepId: 1,
              stepName: stepOneName + "-error",
              stepType: "SleepFor",
              sleepFor: 1,
              concurrent: 1,
            },
          ],
          [
            ["init"],
            [
              "onError",
              {
                workflowRunId: "wfr-id",
                error: expect.any(Error),
              },
            ],
          ],
          500
        );
      });
    });
  });
});
