import { NO_CONCURRENCY } from "../constants";
import { attachStepNameToError, WorkflowAbort } from "../error";
import { Step, StepSettings, Telemetry } from "../types";
import { WorkflowContext } from "../context";
import { BaseLazyStep } from "../context/steps";
import { getHeaders, getStepSettingsHeaders } from "./headers";
import { DispatchDebug, DispatchLifecycle } from "../middleware/types";

/**
 * Submits parallel steps to QStash.
 *
 * Each plan step carries the step-level settings (flow control, retries)
 * of its target step, since the delivery of a plan step is what executes
 * the target step.
 *
 * @param context workflow context
 * @param steps list of lazy steps to submit
 * @param initialStepCount initial step count
 * @param invokeCount current invoke count
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 */
export const submitParallelSteps = async ({
  context,
  steps,
  initialStepCount,
  invokeCount,
  telemetry,
  dispatchDebug,
}: {
  context: WorkflowContext;
  steps: BaseLazyStep[];
  initialStepCount: number;
  invokeCount: number;
  telemetry?: Telemetry;
  dispatchDebug: DispatchDebug;
}) => {
  const planSteps = steps.map((step, index) =>
    step.getPlanStep(steps.length, initialStepCount + index)
  );

  await dispatchDebug("onInfo", {
    info: `Submitting ${planSteps.length} parallel steps.`,
  });

  const result = (await context.qstashClient.batch(
    planSteps.map((planStep, index) => {
      const { headers } = getHeaders({
        initHeaderValue: "false",
        workflowConfig: {
          workflowRunId: context.workflowRunId,
          workflowUrl: context.url,
          telemetry,
        },
        invokeCount,
      });

      return {
        headers: {
          ...headers,
          ...getStepSettingsHeaders(steps[index].stepSettings),
        },
        method: "POST",
        url: context.url,
        body: JSON.stringify(planStep),
        notBefore: planStep.sleepUntil,
        delay: planStep.sleepFor,
      };
    })
  )) as { messageId: string }[];

  if (result && result.length > 0) {
    await dispatchDebug("onInfo", {
      info: `Submitted ${planSteps.length} parallel steps. messageIds: ${result
        .filter((r) => r)
        .map((r) => r.messageId)
        .join(", ")}.`,
    });
  }

  throw new WorkflowAbort(planSteps[0].stepName, planSteps[0]);
};

/**
 * Executes a lazy step and returns its result step, without submitting
 * it to QStash.
 *
 * @param lazyStep lazy step to execute
 * @param stepId step ID
 * @param concurrency concurrency level
 * @param dispatchLifecycle lifecycle event dispatcher
 */
export const executeStep = async ({
  lazyStep,
  stepId,
  concurrency,
  dispatchLifecycle,
}: {
  lazyStep: BaseLazyStep;
  stepId: number;
  concurrency: number;
  dispatchLifecycle: DispatchLifecycle;
}): Promise<Step> => {
  await dispatchLifecycle("beforeExecution", {
    stepName: lazyStep.stepName,
  });

  try {
    return await lazyStep.getResultStep(concurrency, stepId);
  } catch (error) {
    // The step function threw. Remember which step failed so the serve handler
    // can report it to QStash via the `Upstash-Error-Step-Name` header.
    attachStepNameToError(error, lazyStep.stepName);
    throw error;
  }
};

/**
 * Submits an executed step's result to QStash.
 *
 * If `nextStepSettings` is passed, the step-level settings of the next
 * step are attached to the request. Since the delivery of this request
 * is what executes the next step, this is how step-level settings
 * (flow control, retries) are applied to the next step.
 *
 * @param context workflow context
 * @param lazyStep lazy step which was executed
 * @param resultStep result step to submit
 * @param invokeCount current invoke count
 * @param concurrency concurrency level
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 * @param nextStepSettings step-level settings of the next step
 */
export const submitStepResult = async ({
  context,
  lazyStep,
  resultStep,
  invokeCount,
  concurrency,
  telemetry,
  dispatchDebug,
  nextStepSettings,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  resultStep: Step;
  invokeCount: number;
  concurrency: number;
  telemetry?: Telemetry;
  dispatchDebug: DispatchDebug;
  nextStepSettings?: StepSettings;
}) => {
  const { headers } = lazyStep.getHeaders({
    context,
    step: resultStep,
    invokeCount,
    telemetry,
  });

  const finalHeaders = {
    ...headers,
    ...getStepSettingsHeaders(nextStepSettings),
  };

  const body = lazyStep.getBody({
    context,
    step: resultStep,
    headers: finalHeaders,
    invokeCount,
    telemetry,
  });

  const submitResult = await lazyStep.submitStep({
    context,
    body,
    headers: finalHeaders,
    isParallel: concurrency !== NO_CONCURRENCY,
    invokeCount,
    step: resultStep,
    telemetry,
  });

  if (submitResult && submitResult[0]) {
    await dispatchDebug("onInfo", {
      info: `Submitted step "${resultStep.stepName}" with messageId: ${submitResult[0].messageId}.`,
    });
  }

  return resultStep;
};

/**
 * Submits a single step to QStash.
 *
 * @param context workflow context
 * @param lazyStep lazy step to submit
 * @param stepId step ID
 * @param invokeCount current invoke count
 * @param concurrency concurrency level
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 * @param dispatchLifecycle lifecycle event dispatcher
 */
export const submitSingleStep = async ({
  context,
  lazyStep,
  stepId,
  invokeCount,
  concurrency,
  telemetry,
  dispatchDebug,
  dispatchLifecycle,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  stepId: number;
  invokeCount: number;
  concurrency: number;
  telemetry?: Telemetry;
  dispatchDebug: DispatchDebug;
  dispatchLifecycle: DispatchLifecycle;
}) => {
  const resultStep = await executeStep({
    lazyStep,
    stepId,
    concurrency,
    dispatchLifecycle,
  });

  return await submitStepResult({
    context,
    lazyStep,
    resultStep,
    invokeCount,
    concurrency,
    telemetry,
    dispatchDebug,
  });
};
