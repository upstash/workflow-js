import type { Client, HTTPMethods } from "@upstash/qstash";
import type {
  InvokeStepResponse,
  NotifyStepResponse,
  Step,
  StepFunction,
  StepType,
  WaitStepResponse,
} from "../types";
import { makeNotifyRequest } from "../client/utils";
import type { Duration } from "../types";
import { WorkflowError } from "../error";
import { getWorkflowRunId } from "../utils";
import { serveBase } from "../serve";

/**
 * Base class outlining steps. Basically, each step kind (run/sleep/sleepUntil)
 * should have two methods: getPlanStep & getResultStep.
 *
 * getPlanStep works the same way for all so it's implemented here.
 * The different step types will implement their own getResultStep method.
 */
export abstract class BaseLazyStep<TResult = unknown> {
  public readonly stepName;
  public abstract readonly stepType: StepType; // will be set in the subclasses
  constructor(stepName: string) {
    if (!stepName) {
      throw new WorkflowError(
        "A workflow step name cannot be undefined or an empty string. Please provide a name for your workflow step."
      );
    }
    this.stepName = stepName;
  }

  /**
   * plan step to submit when step will run parallel with other
   * steps (parallel call state `first`)
   *
   * @param concurrent number of steps running parallel
   * @param targetStep target step id corresponding to this step
   * @returns
   */
  public abstract getPlanStep(concurrent: number, targetStep: number): Step<undefined>;

  /**
   * result step to submit after the step executes. Used in single step executions
   * and when a plan step executes in parallel executions (parallel call state `partial`).
   *
   * @param concurrent
   * @param stepId
   */
  public abstract getResultStep(concurrent: number, stepId: number): Promise<Step<TResult>>;
}

/**
 * Lazy step definition for `context.run` case
 */
export class LazyFunctionStep<TResult = unknown> extends BaseLazyStep<TResult> {
  private readonly stepFunction: StepFunction<TResult>;
  stepType: StepType = "Run";

  constructor(stepName: string, stepFunction: StepFunction<TResult>) {
    super(stepName);
    this.stepFunction = stepFunction;
  }

  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      concurrent,
      targetStep,
    };
  }

  public async getResultStep(concurrent: number, stepId: number): Promise<Step<TResult>> {
    let result = this.stepFunction();
    if (result instanceof Promise) {
      result = await result;
    }

    return {
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      out: result,
      concurrent,
    };
  }
}

/**
 * Lazy step definition for `context.sleep` case
 */
export class LazySleepStep extends BaseLazyStep {
  private readonly sleep: number | Duration;
  stepType: StepType = "SleepFor";

  constructor(stepName: string, sleep: number | Duration) {
    super(stepName);
    this.sleep = sleep;
  }

  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      sleepFor: this.sleep,
      concurrent,
      targetStep,
    };
  }

  public async getResultStep(concurrent: number, stepId: number): Promise<Step> {
    return await Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      sleepFor: this.sleep,
      concurrent,
    });
  }
}

/**
 * Lazy step definition for `context.sleepUntil` case
 */
export class LazySleepUntilStep extends BaseLazyStep {
  private readonly sleepUntil: number;
  stepType: StepType = "SleepUntil";

  constructor(stepName: string, sleepUntil: number) {
    super(stepName);
    this.sleepUntil = sleepUntil;
  }

  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      sleepUntil: this.sleepUntil,
      concurrent,
      targetStep,
    };
  }

  public async getResultStep(concurrent: number, stepId: number): Promise<Step> {
    return await Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      sleepUntil: this.sleepUntil,
      concurrent,
    });
  }
}

export class LazyCallStep<TResult = unknown, TBody = unknown> extends BaseLazyStep<TResult> {
  private readonly url: string;
  private readonly method: HTTPMethods;
  private readonly body: TBody;
  private readonly headers: Record<string, string>;
  public readonly retries: number;
  public readonly timeout?: number | Duration;
  stepType: StepType = "Call";

  constructor(
    stepName: string,
    url: string,
    method: HTTPMethods,
    body: TBody,
    headers: Record<string, string>,
    retries: number,
    timeout: number | Duration | undefined
  ) {
    super(stepName);
    this.url = url;
    this.method = method;
    this.body = body;
    this.headers = headers;
    this.retries = retries;
    this.timeout = timeout;
  }

  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      concurrent,
      targetStep,
    };
  }

  public async getResultStep(concurrent: number, stepId: number): Promise<Step<TResult>> {
    return await Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      concurrent,
      callUrl: this.url,
      callMethod: this.method,
      callBody: this.body,
      callHeaders: this.headers,
    });
  }
}

export class LazyWaitForEventStep extends BaseLazyStep<WaitStepResponse> {
  private readonly eventId: string;
  private readonly timeout: string;
  stepType: StepType = "Wait";

  constructor(
    stepName: string,
    eventId: string,
    timeout: string // TODO: string format and accept number as smth
  ) {
    super(stepName);
    this.eventId = eventId;
    this.timeout = timeout;
  }

  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      waitEventId: this.eventId,
      timeout: this.timeout,
      concurrent,
      targetStep,
    };
  }

  public async getResultStep(concurrent: number, stepId: number): Promise<Step<WaitStepResponse>> {
    return await Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      waitEventId: this.eventId,
      timeout: this.timeout,
      concurrent,
    });
  }
}

export class LazyNotifyStep extends LazyFunctionStep<NotifyStepResponse> {
  stepType: StepType = "Notify";

  constructor(stepName: string, eventId: string, eventData: unknown, requester: Client["http"]) {
    super(stepName, async () => {
      const notifyResponse = await makeNotifyRequest(requester, eventId, eventData);

      return {
        eventId,
        eventData,
        notifyResponse,
      };
    });
  }
}

export type LazyInvokeStepParams<TInitiaPayload, TResult> = {
  workflow: Pick<
    ReturnType<typeof serveBase<TInitiaPayload, Request, Response, TResult>>,
    "workflowId" | "telemetry"
  >;
  body: TInitiaPayload;
  headers?: Record<string, string>;
  workflowRunId?: string;
};
export class LazyInvokeStep<TResult = unknown, TBody = unknown> extends BaseLazyStep<
  InvokeStepResponse<TResult>
> {
  stepType: StepType = "Invoke";
  params: Required<LazyInvokeStepParams<TBody, TResult>>;
  constructor(
    stepName: string,
    { workflow, body, headers = {}, workflowRunId }: LazyInvokeStepParams<TBody, TResult>
  ) {
    super(stepName);
    this.params = {
      workflow,
      body,
      headers,
      workflowRunId: getWorkflowRunId(workflowRunId),
    };
  }
  public getPlanStep(concurrent: number, targetStep: number): Step<undefined> {
    return {
      stepId: 0,
      stepName: this.stepName,
      stepType: this.stepType,
      concurrent,
      targetStep,
    };
  }
  /**
   * won't be used as it's the server who will add the result step
   * in Invoke step.
   */
  public getResultStep(
    concurrent: number,
    stepId: number
  ): Promise<Step<InvokeStepResponse<TResult>>> {
    return Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      concurrent,
    });
  }
}
