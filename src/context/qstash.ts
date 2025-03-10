import { NO_CONCURRENCY } from "../constants";
import { WorkflowAbort } from "../error";
import { WorkflowLogger } from "../logger";
import { Telemetry } from "../types";
import { getHeaders } from "../workflow-requests";
import { WorkflowContext } from "./context";
import { BaseLazyStep } from "./steps";

export const submitParallelSteps = async ({
  context,
  steps,
  initialStepCount,
  invokeCount,
  telemetry,
}: {
  context: WorkflowContext;
  steps: BaseLazyStep[];
  initialStepCount: number;
  invokeCount: number;
  telemetry?: Telemetry;
}) => {
  const planSteps = steps.map((step, index) =>
    step.getPlanStep(steps.length, initialStepCount + index)
  );
  await context.qstashClient.batch(
    planSteps.map((planStep) => {
      const { headers } = getHeaders({
        initHeaderValue: "false",
        workflowRunId: context.workflowRunId,
        workflowUrl: context.url,
        userHeaders: context.headers,
        failureUrl: context.failureUrl,
        retries: context.retries,
        flowControl: context.flowControl,
        step: planStep,
        telemetry,
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
  );

  throw new WorkflowAbort(planSteps[0].stepName, planSteps[0]);
};

export const submitSingleStep = async ({
  context,
  lazyStep,
  stepId,
  invokeCount,
  concurrency,
  telemetry,
  debug,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  stepId: number;
  invokeCount: number;
  concurrency: number;
  telemetry?: Telemetry;
  debug?: WorkflowLogger;
}) => {
  const resultStep = await lazyStep.getResultStep(concurrency, stepId);
  await debug?.log("INFO", "RUN_SINGLE", {
    fromRequest: false,
    step: resultStep,
    stepCount: stepId,
  });

  const { headers, timeoutHeaders } = lazyStep.getHeaders({
    context,
    step: resultStep,
    invokeCount,
    telemetry,
  });
  const body = lazyStep.getBody({
    context,
    step: resultStep,
    headers,
    timeoutHeaders,
    invokeCount,
    telemetry,
  });
  await lazyStep.submitStep({
    context,
    body,
    headers,
    isParallel: concurrency !== NO_CONCURRENCY,
    invokeCount,
    step: resultStep,
    telemetry,
  });
  return resultStep;
};
