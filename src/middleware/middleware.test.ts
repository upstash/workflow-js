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
          const { context, ...rest } = params;
          accumulator.push(["afterExecution", { ...rest, workflowRunId: context.workflowRunId }]);
        },
        beforeExecution(params) {
          const { context, ...rest } = params;
          accumulator.push(["beforeExecution", { ...rest, workflowRunId: context.workflowRunId }]);
        },
        runStarted(params) {
          const { context, ...rest } = params;
          accumulator.push(["runStarted", { ...rest, workflowRunId: context.workflowRunId }]);
        },
        runCompleted(params) {
          const { context, ...rest } = params;
          accumulator.push(["runCompleted", { ...rest, workflowRunId: context.workflowRunId }]);
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
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepOneName,
                result: undefined,
              },
            ],
            [
              "beforeExecution",
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
          middlewareAccumaltor: [
            ["init"],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: stepTwoName,
                result: stepResult,
              },
            ],
          ],
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
          middlewareAccumaltor: [
            ["init"],
            [
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                stepName: parallelRunTwo,
                result: stepResultTwo,
              },
            ],
          ],
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
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                result: stepResultOne,
                stepName: parallelRunOne,
              },
            ],
            [
              "beforeExecution",
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
              "afterExecution",
              {
                workflowRunId: "wfr-id",
                result: undefined,
                stepName: stepThreeName,
              },
            ],
            [
              "runCompleted",
              {
                workflowRunId: "wfr-id",
                result: undefined,
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
        expectedAccumulator: ReturnType<typeof createLoggingMiddleware>["accumulator"]
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
        expect(response.status).toBe(200);

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
    });
  });
});
