import { NO_CONCURRENCY, WORKFLOW_DISCOVERY_CALL_TYPE } from "../constants";
import { attachStepNameToError, WorkflowAbort } from "../error";
import { Step, Telemetry } from "../types";
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
 * @param context workflow context
 * @param lazyStep lazy step which was executed
 * @param resultStep result step to submit
 * @param invokeCount current invoke count
 * @param concurrency concurrency level
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 */
export const submitStepResult = async ({
  context,
  lazyStep,
  resultStep,
  invokeCount,
  concurrency,
  telemetry,
  dispatchDebug,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  resultStep: Step;
  invokeCount: number;
  concurrency: number;
  telemetry?: Telemetry;
  dispatchDebug: DispatchDebug;
}) => {
  const { headers } = lazyStep.getHeaders({
    context,
    step: resultStep,
    invokeCount,
    telemetry,
  });

  const body = lazyStep.getBody({
    context,
    step: resultStep,
    headers,
    invokeCount,
    telemetry,
  });

  const submitResult = await lazyStep.submitStep({
    context,
    body,
    headers,
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

/**
 * Publishes a hidden helper request which makes QStash call the workflow
 * endpoint again, this time with the step-level settings of the step
 * which is about to execute.
 *
 * A step's settings must be on the request whose delivery executes the
 * step. The request delivered to the endpoint right now was published
 * before the step was known, so it carries the settings of the run
 * instead. Rather than executing the step in this (ungated) delivery, we
 * publish this request with the settings: QStash delivers it gated by
 * the step-level flow control / retries, and that delivery executes the
 * step.
 *
 * The request has the `discovery` call type: QStash doesn't treat it as
 * a step and hides it from the step logs. Its body carries the target
 * step id, which
 * - makes the request unique per step, so that QStash's content based
 *   deduplication doesn't collapse the redeliveries of two steps, while
 *   still collapsing a duplicate publish for the same step (which is
 *   what happens when a delivery is retried after publishing it), and
 * - lets the executor recognize, on the redelivery, that the step it is
 *   about to run was already gated (see `parseDiscoveryTargets`).
 *
 * @param context workflow context
 * @param lazyStep lazy step whose settings are applied
 * @param targetStep id of the step which the redelivery will execute
 * @param invokeCount current invoke count
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 */
export const publishStepSettingsRedelivery = async ({
  context,
  lazyStep,
  targetStep,
  invokeCount,
  telemetry,
  dispatchDebug,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  targetStep: number;
  invokeCount: number;
  telemetry?: Telemetry;
  dispatchDebug: DispatchDebug;
}) => {
  const { headers } = getHeaders({
    initHeaderValue: "false",
    workflowConfig: {
      workflowRunId: context.workflowRunId,
      workflowUrl: context.url,
      telemetry,
    },
    invokeCount,
  });

  await dispatchDebug("onInfo", {
    info:
      `Step "${lazyStep.stepName}" (${targetStep}) has step-level settings.` +
      ` Requesting a redelivery with the settings applied.`,
  });

  const result = (await context.qstashClient.publishJSON({
    headers: {
      ...headers,
      ...getStepSettingsHeaders(lazyStep.stepSettings),
      "Upstash-Workflow-CallType": WORKFLOW_DISCOVERY_CALL_TYPE,
    },
    method: "POST",
    body: { discoveryTargetStep: targetStep },
    url: context.url,
  })) as { messageId?: string };

  if (result?.messageId) {
    await dispatchDebug("onInfo", {
      info: `Requested redelivery for step "${lazyStep.stepName}" with messageId: ${result.messageId}.`,
    });
  }
};
