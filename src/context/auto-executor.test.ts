/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, expect, spyOn, test } from "bun:test";
import { WorkflowContext } from "./context";
import { Client, QstashError } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { nanoid } from "../utils";
import { AutoExecutor } from "./auto-executor";
import type { Step, StepSettings } from "../types";
import type { EffectiveConfig } from "../qstash/step-config";
import { flushPendingStep } from "../workflow-requests";
import { WorkflowAbort, WorkflowError } from "../error";

class SpyAutoExecutor extends AutoExecutor {
  public declare getParallelCallState;
  public declare runSingle;
  public declare runParallel;
}

class SpyWorkflowContext extends WorkflowContext {
  public declare executor: SpyAutoExecutor;
}

/**
 * in these tests, we create a context by passing it
 * steps manually.
 *
 * In each test, we:
 * - create a context from `initialStep`, `singleStep` and `parallelSteps`
 * - create spies on runSingle and runParallel of the auto-executor
 * - create a mock qstash server (the server is provided the expected request body/method/headers)
 * - run single step or parallel steps in different stages of execution and check the server
 * - check how the spy was called
 */
describe("auto-executor", () => {
  const initialPayload = { initial: "payload" };
  const token = nanoid();
  const workflowRunId = nanoid();

  const initialStep: Step = {
    stepId: 0,
    stepName: "init",
    stepType: "Initial",
    out: JSON.stringify(initialPayload),
    concurrent: 1,
  };

  const singleStep: Step = {
    stepId: 1,
    stepName: "attemptCharge",
    stepType: "Run",
    out: JSON.stringify({ input: initialPayload, success: false }),
    concurrent: 1,
  };

  const parallelSteps: Step[] = [
    {
      stepId: 0,
      stepName: "sleep for some time",
      stepType: "SleepFor",
      sleepFor: 123,
      concurrent: 2,
      targetStep: 1,
    },
    {
      stepId: 0,
      stepName: "sleep until next day",
      stepType: "SleepUntil",
      sleepUntil: 123_123,
      concurrent: 2,
      targetStep: 2,
    },
    {
      stepId: 1,
      stepName: "sleep for some time",
      stepType: "SleepFor",
      sleepFor: 123,
      concurrent: 2,
    },
    {
      stepId: 2,
      stepName: "sleep until next day",
      stepType: "SleepUntil",
      sleepUntil: 123_123,
      concurrent: 2,
    },
  ];

  const getContext = (steps: Step[], effectiveConfig?: EffectiveConfig) => {
    return new SpyWorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token, enableTelemetry: false }),
      workflowRunId,
      initialPayload,
      headers: new Headers({}) as Headers,
      steps,
      effectiveConfig,
      url: WORKFLOW_ENDPOINT,
      invokeCount: 7,
      workflowRunCreatedAt: 0,
    });
  };

  describe("single step", () => {
    test("should send a single step", async () => {
      const context = getContext([initialStep]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: async () => {
          // the step executes and its result is returned, so the route
          // function can continue and reveal what comes next. The
          // submission happens on flush.
          const result = await context.run("attemptCharge", () => {
            return { input: context.requestPayload, success: false };
          });
          expect(result).toEqual({ input: initialPayload, success: false });
          const submitted = await flushPendingStep(context);
          expect(submitted._unsafeUnwrap().result).toBe("submitted-step");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify({
                ...singleStep,
              }),
            },
          ],
        },
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(1);
      const lazyStep = spyRunSingle.mock.calls[0][0];
      expect(lazyStep.stepName).toBe("attemptCharge");
      expect(lazyStep.stepType).toBe("Run");

      expect(spyRunParallel).toHaveBeenCalledTimes(0);
    });

    test("should use single step result from request", async () => {
      const context = getContext([initialStep, singleStep]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: async () => {
          expect(context.executor.stepCount).toBe(0);
          expect(context.executor.planStepCount).toBe(0);
          const result = await context.run("attemptCharge", () => {
            return { input: context.requestPayload, success: false };
          });
          expect(context.executor.stepCount).toBe(1);
          expect(context.executor.planStepCount).toBe(0);
          expect(result).toEqual({
            input: context.requestPayload,
            success: false,
          });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(1);
      const lazyStep = spyRunSingle.mock.calls[0][0];
      expect(lazyStep.stepName).toBe("attemptCharge");
      expect(lazyStep.stepType).toBe("Run");

      expect(spyRunParallel).toHaveBeenCalledTimes(0);
    });
  });

  describe("parallel steps", () => {
    test("should send plan steps in first encounter: should send plan steps as batch", async () => {
      const context = getContext([initialStep]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("first");
          const throws = Promise.all([
            context.sleep("sleep for 123s", 123),
            context.sleep("sleep for 10m", "10m"),
            context.sleepUntil("sleep until next day", 123_123),
            context.waitForEvent("waitEvent", "my-event", { timeout: "5m" }),
          ]);
          expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              body: '{"stepId":0,"stepName":"sleep for 123s","stepType":"SleepFor","sleepFor":123,"concurrent":4,"targetStep":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-delay": "123s",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
            },
            {
              body: '{"stepId":0,"stepName":"sleep for 10m","stepType":"SleepFor","sleepFor":"10m","concurrent":4,"targetStep":2}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-delay": "10m",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
            },
            {
              body: '{"stepId":0,"stepName":"sleep until next day","stepType":"SleepUntil","sleepUntil":123123,"concurrent":4,"targetStep":3}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-not-before": "123123",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
            },
            {
              body: '{"stepId":0,"stepName":"waitEvent","stepType":"Wait","waitEventId":"my-event","timeout":"5m","concurrent":4,"targetStep":4}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
            },
          ],
        },
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(0);

      expect(spyRunParallel).toHaveBeenCalledTimes(1);
      const lazySteps = spyRunParallel.mock.calls[0][0];
      expect(lazySteps.length).toBe(4);
      expect(lazySteps[0].stepType).toBe("SleepFor");
      expect(lazySteps[1].stepType).toBe("SleepFor");
      expect(lazySteps[2].stepType).toBe("SleepUntil");
      expect(lazySteps[3].stepType).toBe("Wait");

      expect(lazySteps[0].stepName).toBe("sleep for 123s");
      expect(lazySteps[1].stepName).toBe("sleep for 10m");
      expect(lazySteps[2].stepName).toBe("sleep until next day");
      expect(lazySteps[3].stepName).toBe("waitEvent");
    });

    test("should send plan steps in second encounter: should run the first parallel step", async () => {
      const context = getContext([initialStep, parallelSteps[0]]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("partial");
          const throws = Promise.all([
            context.sleep("sleep for some time", 123),
            context.sleepUntil("sleep until next day", 123_123),
          ]);
          expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify(parallelSteps[2]),
            },
          ],
        },
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(0);

      expect(spyRunParallel).toHaveBeenCalledTimes(1);
      const lazySteps = spyRunParallel.mock.calls[0][0];
      expect(lazySteps.length).toBe(2);
      expect(lazySteps[0].stepType).toBe("SleepFor");
      expect(lazySteps[1].stepType).toBe("SleepUntil");
      expect(lazySteps[0].stepName).toBe("sleep for some time");
      expect(lazySteps[1].stepName).toBe("sleep until next day");
    });

    test("should send plan steps in third encounter: should run the second parallel step", async () => {
      const context = getContext([initialStep, ...parallelSteps.slice(0, 2)]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("partial");
          const throws = Promise.all([
            context.sleep("sleep for some time", 123),
            context.sleepUntil("sleep until next day", 123_123),
          ]);
          expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify(parallelSteps[3]),
            },
          ],
        },
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(0);

      expect(spyRunParallel).toHaveBeenCalledTimes(1);
      const lazySteps = spyRunParallel.mock.calls[0][0];
      expect(lazySteps.length).toBe(2);
      expect(lazySteps[0].stepType).toBe("SleepFor");
      expect(lazySteps[1].stepType).toBe("SleepUntil");
      expect(lazySteps[0].stepName).toBe("sleep for some time");
      expect(lazySteps[1].stepName).toBe("sleep until next day");
    });

    test("should send plan steps in fourth encounter: should discard", async () => {
      const context = getContext([initialStep, ...parallelSteps.slice(0, 3)]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("discard");
          const throws = Promise.all([
            context.sleep("sleep for some time", 123),
            context.sleepUntil("sleep until next day", 123_123),
          ]);
          expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(0);

      expect(spyRunParallel).toHaveBeenCalledTimes(1);
      const lazySteps = spyRunParallel.mock.calls[0][0];
      expect(lazySteps.length).toBe(2);
      expect(lazySteps[0].stepType).toBe("SleepFor");
      expect(lazySteps[1].stepType).toBe("SleepUntil");
      expect(lazySteps[0].stepName).toBe("sleep for some time");
      expect(lazySteps[1].stepName).toBe("sleep until next day");
    });

    test("should send plan steps in fifth and final encounter: should return the result", async () => {
      const context = getContext([initialStep, ...parallelSteps]);

      const spyRunSingle = spyOn(context.executor, "runSingle");
      const spyRunParallel = spyOn(context.executor, "runParallel");

      await mockQStashServer({
        execute: async () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("last");
          expect(context.executor.stepCount).toBe(0);
          expect(context.executor.planStepCount).toBe(0);
          const result = await Promise.all([
            context.sleep("sleep for some time", 123),
            context.sleepUntil("sleep until next day", 123_123),
          ]);
          expect(result).toEqual([undefined, undefined]);
          expect(context.executor.stepCount).toBe(2);
          expect(context.executor.planStepCount).toBe(2);
          expect(context.executor.getParallelCallState(2, 3)).toBe("first");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });

      expect(spyRunSingle).toHaveBeenCalledTimes(0);

      expect(spyRunParallel).toHaveBeenCalledTimes(1);
      const lazySteps = spyRunParallel.mock.calls[0][0];
      expect(lazySteps.length).toBe(2);
      expect(lazySteps[0].stepType).toBe("SleepFor");
      expect(lazySteps[1].stepType).toBe("SleepUntil");
      expect(lazySteps[0].stepName).toBe("sleep for some time");
      expect(lazySteps[1].stepName).toBe("sleep until next day");
    });
  });

  describe("should throw error when step name/type changes", () => {
    describe("single step", () => {
      test("step name", () => {
        const context = getContext([initialStep, singleStep]);

        const throws = context.run("wrongName", () => {
          return true;
        });
        expect(throws).rejects.toThrow(
          new WorkflowError(
            "Incompatible step name. Expected 'wrongName', got 'attemptCharge' from the request"
          )
        );
      });
      test("step type", () => {
        const context = getContext([initialStep, singleStep]);
        const throws = context.sleep("attemptCharge", 10);
        expect(throws).rejects.toThrow(
          new WorkflowError(
            "Incompatible step type. Expected 'SleepFor', got 'Run' from the request"
          )
        );
      });
    });

    describe("paralel with ParallelCallState: partial", () => {
      test("step name", () => {
        const context = getContext([initialStep, parallelSteps[0]]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("partial");

        const throws = Promise.all([
          context.sleep("wrongName", 10), // wrong step name
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrow(
          new WorkflowError(
            "Incompatible step name. Expected 'wrongName', got 'sleep for some time' from the request"
          )
        );
      });
      test("step type", () => {
        const context = getContext([initialStep, parallelSteps[0]]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("partial");

        const throws = Promise.all([
          context.sleepUntil("sleep for some time", 10), // wrong step type
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrow(
          new WorkflowError(
            "Incompatible step type. Expected 'SleepUntil', got 'SleepFor' from the request"
          )
        );
      });
    });

    describe("shouldn't throw incompatibility error when paralel with ParallelCallState: discard", () => {
      test("step name", () => {
        const context = getContext([initialStep, ...parallelSteps.slice(0, 3)]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("discard");

        const throws = Promise.all([
          context.sleep("wrongName", 10), // wrong step name
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrowError(WorkflowAbort);
      });
      test("step type", () => {
        const context = getContext([initialStep, ...parallelSteps.slice(0, 3)]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("discard");

        const throws = Promise.all([
          context.sleepUntil("sleep for some time", 10), // wrong step type
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrowError(WorkflowAbort);
      });
    });

    describe("paralel with ParallelCallState: last", () => {
      test("step name", () => {
        const context = getContext([initialStep, ...parallelSteps]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("last");

        const throws = Promise.all([
          context.sleep("wrongName", 10), // wrong step name
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrowError(
          new WorkflowError(
            "Incompatible steps detected in parallel execution: Incompatible step name. Expected 'wrongName', got 'sleep for some time' from the request\n" +
              '  > Step Names from the request: ["sleep for some time","sleep until next day"]\n' +
              '    Step Types from the request: ["SleepFor","SleepUntil"]\n' +
              '  > Step Names expected: ["wrongName","sleep until next day"]\n' +
              '    Step Types expected: ["SleepFor","SleepUntil"]'
          )
        );
      });
      test("step type", () => {
        const context = getContext([initialStep, ...parallelSteps]);
        expect(context.executor.getParallelCallState(2, 1)).toBe("last");

        const throws = Promise.all([
          context.sleepUntil("sleep for some time", 10), // wrong step type
          context.sleepUntil("sleep until next day", 123_123),
        ]);
        expect(throws).rejects.toThrowError(
          new WorkflowError(
            "Incompatible steps detected in parallel execution: Incompatible step type. Expected 'SleepUntil', got 'SleepFor' from the request\n" +
              '  > Step Names from the request: ["sleep for some time","sleep until next day"]\n' +
              '    Step Types from the request: ["SleepFor","SleepUntil"]\n' +
              '  > Step Names expected: ["sleep for some time","sleep until next day"]\n' +
              '    Step Types expected: ["SleepUntil","SleepUntil"]'
          )
        );
      });
    });
  });

  describe("step-level settings", () => {
    const settings: StepSettings = {
      flowControl: { key: "step-flow-key", parallelism: 2, rate: 10 },
      retries: 5,
      retryDelay: "1000",
    };

    /**
     * effective configuration of a delivery which was published with
     * `settings`, in the shape QStash reports it back: the control value
     * joined without spaces, and the guard marker present.
     */
    const stepConfigured: EffectiveConfig = {
      flowControl: { key: "step-flow-key", parallelism: 2, rate: 10, period: 1 },
      retries: 5,
      retryDelay: "1000",
      hasStepConfig: true,
    };

    const unstepConfigured: EffectiveConfig = { retries: 3, hasStepConfig: false };

    test("should publish a step config request when the delivery is ordinary", async () => {
      const context = getContext([initialStep], unstepConfigured);

      let stepExecuted = false;
      await mockQStashServer({
        execute: async () => {
          const throws = context
            .run("attemptCharge", () => {
              stepExecuted = true;
              return "result";
            })
            .withSettings(settings);
          await expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: { messageId: "msgId" },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
          token,
          // the target step keeps the requests of two different steps
          // distinct under the content based deduplication below
          body: { targetStep: 1, invokeCount: 7 },
          headers: {
            "upstash-workflow-calltype": "stepConfig",
            // a retry of the delivery which published this collapses
            // into it rather than publishing a second request
            "upstash-content-based-deduplication": "true",
            "upstash-workflow-runid": workflowRunId,
            "upstash-workflow-init": "false",
            "upstash-workflow-url": WORKFLOW_ENDPOINT,
            "upstash-feature-set":
              "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig,WF_StepConfig",
            "upstash-flow-control-key": "step-flow-key",
            "upstash-flow-control-value": "parallelism=2, rate=10",
            "upstash-retries": "5",
            "upstash-retry-delay": "1000",
          },
        },
      });

      // the step must not run in an ordinary delivery
      expect(stepExecuted).toBeFalse();
    });

    test("should surface a failure to publish the step config request", async () => {
      const context = getContext([initialStep], unstepConfigured);

      let stepExecuted = false;
      await mockQStashServer({
        execute: async () => {
          const throws = context
            .run("attemptCharge", () => {
              stepExecuted = true;
              return "result";
            })
            .withSettings(settings);
          // no settings were applied and nothing was submitted, so the publish
          // error has to surface rather than an abort claiming otherwise
          await expect(throws).rejects.toThrowError(QstashError);
        },
        responseFields: {
          status: 500,
          body: "publish failed",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
          token,
          body: { targetStep: 1, invokeCount: 7 },
        },
      });

      expect(stepExecuted).toBeFalse();
    });

    test("should execute the step when the delivery already has its settings", async () => {
      const context = getContext([initialStep], stepConfigured);

      let stepExecuted = false;
      await mockQStashServer({
        execute: async () => {
          const result = await context
            .run("attemptCharge", () => {
              stepExecuted = true;
              return { input: context.requestPayload, success: false };
            })
            .withSettings(settings);
          expect(result).toEqual({ input: initialPayload, success: false });
          const submitted = await flushPendingStep(context);
          expect(submitted._unsafeUnwrap().result).toBe("submitted-step");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                // the result submission carries no step settings: they
                // belonged to the delivery which executed the step
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify({ ...singleStep }),
            },
          ],
        },
      });

      expect(stepExecuted).toBeTrue();
    });

    test("should execute and warn on a mismatch the guard marker forbids retrying", async () => {
      // the delivery says it carries step settings, but they are not the
      // ones the step asked for: an SDK bug. Executing with the wrong
      // settings is preferred over looping on step config requests.
      const context = getContext([initialStep], {
        flowControl: { key: "some-other-key", parallelism: 1, rate: 0, period: 1 },
        retries: 5,
        retryDelay: "1000",
        hasStepConfig: true,
      });

      const warnings: string[] = [];
      const warnSpy = spyOn(console, "warn").mockImplementation((warning: string) => {
        warnings.push(warning);
      });

      let stepExecuted = false;
      await mockQStashServer({
        execute: async () => {
          await context
            .run("attemptCharge", () => {
              stepExecuted = true;
              return { input: context.requestPayload, success: false };
            })
            .withSettings(settings);
          const submitted = await flushPendingStep(context);
          expect(submitted._unsafeUnwrap().result).toBe("submitted-step");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify({ ...singleStep }),
            },
          ],
        },
      });

      expect(stepExecuted).toBeTrue();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toInclude("attemptCharge");
      expect(warnings[0]).toInclude("flow control");
      expect(warnings[0]).toInclude("bug in @upstash/workflow");
      warnSpy.mockRestore();
    });

    test("should surface a failure to submit the held step", async () => {
      const context = getContext([initialStep], unstepConfigured);

      await mockQStashServer({
        execute: async () => {
          await context.run("attemptCharge", () => {
            return { input: context.requestPayload, success: false };
          });

          // the step ran but its result never reached QStash, so the
          // failure has to surface rather than an abort saying it did
          const submitted = await flushPendingStep(context);
          expect(submitted._unsafeUnwrapErr()).toBeInstanceOf(QstashError);
        },
        responseFields: {
          status: 500,
          body: "submit failed",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
        },
      });
    });

    test("should attach the next step's settings to the pending submission", async () => {
      const context = getContext([initialStep], unstepConfigured);

      await mockQStashServer({
        execute: async () => {
          // the first step has no settings, so it executes here and its
          // result is returned, letting the route function branch on it
          const result = await context.run("attemptCharge", () => {
            return { input: context.requestPayload, success: false };
          });
          expect(result).toEqual({ input: initialPayload, success: false });

          // reaching the next step flushes the pending submission with
          // that step's settings attached, so its delivery carries them and
          // no step config request is needed
          const throws = result.success
            ? context.run("unexpected-branch", () => "not-executed")
            : context.run("second-step", () => "not-executed").withSettings(settings);
          await expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig,WF_StepConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
                "upstash-flow-control-key": "step-flow-key",
                "upstash-flow-control-value": "parallelism=2, rate=10",
                "upstash-retries": "5",
                "upstash-retry-delay": "1000",
              },
              body: JSON.stringify({ ...singleStep }),
            },
          ],
        },
      });
    });

    test("should keep returning the same abort once a held step is submitted", async () => {
      // Reaching a further step submits the held one and throws the abort
      // from there, so the route function has already seen it by the time
      // serve flushes again. That second flush has to report the same
      // abort rather than "nothing was held", or an invocation whose abort
      // the route function swallowed would carry on as if the step had
      // never run.
      const context = getContext([initialStep], unstepConfigured);
      const spySubmit = spyOn(context.qstashClient, "batch");

      await mockQStashServer({
        execute: async () => {
          await context.run("attemptCharge", () => "first-result");

          let thrown: unknown;
          try {
            await context.run("second-step", () => "not-executed");
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(WorkflowAbort);

          const submitted = (await flushPendingStep(context)) as never as {
            value: { result: string; abort: WorkflowAbort };
          };
          expect(submitted.value.result).toBe("submitted-step");
          expect(submitted.value.abort).toBe(thrown as WorkflowAbort);
          // and it is not submitted a second time
          expect(spySubmit).toHaveBeenCalledTimes(1);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              body: JSON.stringify({ ...singleStep, out: JSON.stringify("first-result") }),
            }),
          ],
        },
      });
    });

    test("should attach nothing when a parallel group comes next", async () => {
      const context = getContext([initialStep], unstepConfigured);
      const spySubmit = spyOn(context.qstashClient, "batch");

      await mockQStashServer({
        execute: async () => {
          await context.run("attemptCharge", () => {
            return { input: context.requestPayload, success: false };
          });

          // parallel steps carry their settings on their own plan steps,
          // so nothing is attached to the pending submission
          const throws = Promise.all([
            context.run("p1", () => "r1").withSettings(settings),
            context.run("p2", () => "r2"),
          ]);
          await expect(throws).rejects.toThrowError(WorkflowAbort);

          // both parallel steps reach the held result, but it is
          // submitted once: the second waits for the first submission
          // rather than starting another
          expect(spySubmit).toHaveBeenCalledTimes(1);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
              },
              body: JSON.stringify({ ...singleStep }),
            },
          ],
        },
      });
    });

    test("should attach each parallel step's own settings to its plan step", async () => {
      // a plan step's delivery is what executes its target step, so the
      // settings ride on the plan step and no step config request is needed
      const context = getContext([initialStep], unstepConfigured);

      await mockQStashServer({
        execute: async () => {
          expect(context.executor.getParallelCallState(2, 1)).toBe("first");
          const throws = Promise.all([
            context
              .run("parallel-step-1", () => "result-1")
              .withSettings({ flowControl: { key: "fc-key-1", parallelism: 1 } }),
            context.run("parallel-step-2", () => "result-2").withSettings({ retries: 0 }),
          ]);
          await expect(throws).rejects.toThrowError(WorkflowAbort);
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              body: '{"stepId":0,"stepName":"parallel-step-1","stepType":"Run","concurrent":2,"targetStep":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig,WF_StepConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
                "upstash-flow-control-key": "fc-key-1",
                "upstash-flow-control-value": "parallelism=1",
              },
            },
            {
              body: '{"stepId":0,"stepName":"parallel-step-2","stepType":"Run","concurrent":2,"targetStep":2}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig,WF_StepConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-init": "false",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-forward-upstash-workflow-invoke-count": "7",
                "upstash-retries": "0",
              },
            },
          ],
        },
      });
    });
  });
});
