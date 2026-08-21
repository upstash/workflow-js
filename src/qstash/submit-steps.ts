import { NO_CONCURRENCY, WORKFLOW_STEP_CONFIG_CALL_TYPE } from "../constants";
import { attachStepNameToError, WorkflowAbort } from "../error";
import { Step, StepSettings, Telemetry } from "../types";
import { WorkflowContext } from "../context";
import { BaseLazyStep } from "../context/steps";
import { getHeaders } from "./headers";
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
        stepSettings: steps[index].stepSettings,
      });

      return {
        headers,
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
 * When `nextStepSettings` is given, they are attached to the request:
 * the delivery of this request is what executes the next step, so this
 * is how a step's settings are applied without an extra step config
 * request.
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
    stepSettings: nextStepSettings,
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
 * Publishes a step config request: a hidden helper request which makes
 * QStash call the workflow endpoint again, this time with the
 * step-level settings of the step which is about to execute.
 *
 * A step's settings must be on the request whose delivery executes the
 * step. The request delivered to the endpoint right now was published
 * before the step was known, so QStash applied the run's configuration
 * to it instead. Rather than executing the step in this ungated
 * delivery, we publish this request with the settings: QStash delivers
 * it gated by the step-level flow control / retries, and that delivery
 * executes the step.
 *
 * The request has the `stepConfig` call type: QStash doesn't treat it as
 * a step and hides it from the step logs.
 *
 * It is published with content based deduplication, and its body carries
 * the target step id. Together those make a second publish for the same
 * step collapse into the first — which is what happens when the delivery
 * that published one is retried — while leaving the requests of two
 * different steps distinct. The deduplication hash covers the workflow
 * run id, so runs never collide with each other.
 *
 * @param context workflow context
 * @param lazyStep lazy step whose settings are applied
 * @param targetStep id of the step which the gated delivery will execute
 * @param invokeCount current invoke count
 * @param telemetry optional telemetry information
 * @param dispatchDebug debug event dispatcher
 */
export const publishStepConfigRequest = async ({
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
    stepSettings: lazyStep.stepSettings,
  });

  await dispatchDebug("onInfo", {
    info:
      `Step "${lazyStep.stepName}" (${targetStep}) has step-level settings which the current` +
      ` delivery was not gated by. Requesting a delivery with the settings applied.`,
  });

  const result = (await context.qstashClient.publishJSON({
    headers: {
      ...headers,
      "Upstash-Workflow-CallType": WORKFLOW_STEP_CONFIG_CALL_TYPE,
    },
    method: "POST",
    body: { targetStep, invokeCount },
    url: context.url,
    contentBasedDeduplication: true,
  })) as { messageId?: string; deduplicated?: boolean };

  if (result?.deduplicated) {
    // A step config request for this step was already published. Either
    // the delivery which published it failed and QStash is retrying it,
    // in which case the original still produces the gated delivery and
    // there is nothing to do here — or this SDK asked twice for the same
    // step, which stalls the run: nothing new was published, so no
    // further delivery follows. Worth a warning either way, since it is
    // the only trace the second case leaves.
    await dispatchDebug("onWarning", {
      warning:
        `A step config request for step "${lazyStep.stepName}" (${targetStep}) was already` +
        ` published and this one was deduplicated. Expected when the delivery which published` +
        ` it is being retried; otherwise the run stops here.`,
    });
  } else if (result?.messageId) {
    await dispatchDebug("onInfo", {
      info: `Requested a gated delivery for step "${lazyStep.stepName}" with messageId: ${result.messageId}.`,
    });
  }
};
