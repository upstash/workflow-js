import { NO_CONCURRENCY } from "../constants";
import { WorkflowAbort } from "../error";
import { Telemetry } from "../types";
import { WorkflowContext } from "../context";
import { BaseLazyStep } from "../context/steps";
import { getHeaders } from "./headers";
import { DispatchDebug, DispatchLifecycle } from "../middleware/types";

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
    planSteps.map((planStep) => {
      const { headers } = getHeaders({
        initHeaderValue: "false",
        workflowConfig: {
          workflowRunId: context.workflowRunId,
          workflowUrl: context.url,
          failureUrl: context.failureUrl,
          retries: context.retries,
          retryDelay: context.retryDelay,
          flowControl: context.flowControl,
          telemetry,
        },
        userHeaders: context.headers,
        invokeCount,
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
  await dispatchLifecycle("beforeExecution", {
    stepName: lazyStep.stepName,
  });

  const resultStep = await lazyStep.getResultStep(concurrency, stepId);

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
