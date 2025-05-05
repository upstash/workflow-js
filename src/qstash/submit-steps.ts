import { NO_CONCURRENCY } from "../constants";
import { WorkflowAbort } from "../error";
import { WorkflowLogger } from "../logger";
import { Telemetry } from "../types";
import { WorkflowContext } from "../context";
import { BaseLazyStep } from "../context/steps";
import { getHeaders } from "./headers";
import { WorkflowMiddleware } from "../middleware";
import { runMiddlewares } from "../middleware/middleware";

export const submitParallelSteps = async ({
  context,
  steps,
  initialStepCount,
  invokeCount,
  telemetry,
  debug,
}: {
  context: WorkflowContext;
  steps: BaseLazyStep[];
  initialStepCount: number;
  invokeCount: number;
  telemetry?: Telemetry;
  debug?: WorkflowLogger;
}) => {
  const planSteps = steps.map((step, index) =>
    step.getPlanStep(steps.length, initialStepCount + index)
  );

  await debug?.log("SUBMIT", "SUBMIT_STEP", {
    length: planSteps.length,
    steps: planSteps,
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

  await debug?.log("INFO", "SUBMIT_STEP", {
    messageIds: result.map((message) => {
      return {
        message: message.messageId,
      };
    }),
  });

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
  middlewares,
}: {
  context: WorkflowContext;
  lazyStep: BaseLazyStep;
  stepId: number;
  invokeCount: number;
  concurrency: number;
  telemetry?: Telemetry;
  debug?: WorkflowLogger;
  middlewares?: WorkflowMiddleware[];
}) => {
  const resultStep = await lazyStep.getResultStep(concurrency, stepId);
  await runMiddlewares(middlewares, "beforeExecution", {
    workflowRunId: context.workflowRunId,
    stepName: resultStep.stepName,
  });
  await debug?.log("INFO", "RUN_SINGLE", {
    fromRequest: false,
    step: resultStep,
    stepCount: stepId,
  });

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

  await debug?.log("SUBMIT", "SUBMIT_STEP", {
    length: 1,
    steps: [resultStep],
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

  await debug?.log("INFO", "SUBMIT_STEP", {
    messageIds: submitResult.map((message) => {
      return {
        message: message.messageId,
      };
    }),
  });

  return resultStep;
};
