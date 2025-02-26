import type { Client, FlowControl, HTTPMethods } from "@upstash/qstash";
import type {
  CallResponse,
  InvokeStepResponse,
  LazyInvokeStepParams,
  NotifyStepResponse,
  RequiredExceptFields,
  Step,
  StepFunction,
  StepType,
  WaitStepResponse,
} from "../types";
import { makeNotifyRequest } from "../client/utils";
import type { Duration } from "../types";
import { WorkflowError } from "../error";
import { getWorkflowRunId } from "../utils";

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
  protected abstract readonly allowUndefinedOut: boolean;

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

  /**
   * parse the out field of a step result.
   *
   * will be called when returning the steps to the context from auto executor
   *
   * @param out field of the step
   * @returns parsed out field
   */
  public parseOut(out: unknown): TResult {
    if (out === undefined) {
      if (this.allowUndefinedOut) {
        return undefined as TResult;
      } else {
        throw new WorkflowError(
          `Error while parsing output of ${this.stepType} step. Expected a string, but got: undefined`
        );
      }
    }

    if (typeof out === "object") {
      if (this.stepType !== "Wait") {
        // this is an error which should never happen.
        console.warn(
          `Error while parsing ${this.stepType} step output. Expected a string, but got object. Please reach out to Upstash Support.`
        );
        return out as TResult;
      }

      return {
        ...out,
        eventData: BaseLazyStep.tryParsing((out as WaitStepResponse).eventData),
      } as TResult;
    }

    if (typeof out !== "string") {
      throw new WorkflowError(
        `Error while parsing output of ${this.stepType} step. Expected a string or undefined, but got: ${typeof out}`
      );
    }

    return this.safeParseOut(out);
  }

  protected safeParseOut(out: string): TResult {
    return BaseLazyStep.tryParsing(out);
  }

  protected static tryParsing(stepOut: unknown) {
    try {
      return JSON.parse(stepOut as string);
    } catch {
      return stepOut;
    }
  }
}

/**
 * Lazy step definition for `context.run` case
 */
export class LazyFunctionStep<TResult = unknown> extends BaseLazyStep<TResult> {
  private readonly stepFunction: StepFunction<TResult>;
  stepType: StepType = "Run";
  allowUndefinedOut = true;

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
  allowUndefinedOut = true;

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
  allowUndefinedOut = true;

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

  protected safeParseOut() {
    return undefined;
  }
}

export class LazyCallStep<TResult = unknown, TBody = unknown> extends BaseLazyStep<
  CallResponse<TResult>
> {
  private readonly url: string;
  private readonly method: HTTPMethods;
  private readonly body: TBody;
  private readonly headers: Record<string, string>;
  public readonly retries: number;
  public readonly timeout?: number | Duration;
  public readonly flowControl?: FlowControl;
  stepType: StepType = "Call";
  allowUndefinedOut = false;

  constructor(
    stepName: string,
    url: string,
    method: HTTPMethods,
    body: TBody,
    headers: Record<string, string>,
    retries: number,
    timeout: number | Duration | undefined,
    flowControl: FlowControl | undefined
  ) {
    super(stepName);
    this.url = url;
    this.method = method;
    this.body = body;
    this.headers = headers;
    this.retries = retries;
    this.timeout = timeout;
    this.flowControl = flowControl;
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

  public async getResultStep(
    concurrent: number,
    stepId: number
  ): Promise<Step<CallResponse<TResult>>> {
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

  protected safeParseOut(out: string): CallResponse<TResult> {
    const { header, status, body } = JSON.parse(out) as {
      header: Record<string, string[]>;
      status: number;
      body: unknown;
    };

    const responseHeaders = new Headers(header);
    if (LazyCallStep.isText(responseHeaders.get("content-type"))) {
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) {
        bytes[i] = out.charCodeAt(i);
      }

      const processedResult = new TextDecoder().decode(bytes);
      const newBody = JSON.parse(processedResult).body;

      return {
        status,
        header,
        body: BaseLazyStep.tryParsing(newBody) as TResult,
      };
    } else {
      return { header, status, body: body as TResult };
    }
  }

  private static applicationHeaders = new Set([
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
    "application/xhtml+xml",
    "application/ld+json",
    "application/rss+xml",
    "application/atom+xml",
  ]);

  private static isText = (contentTypeHeader: string | null) => {
    if (!contentTypeHeader) {
      return false;
    }
    if (LazyCallStep.applicationHeaders.has(contentTypeHeader)) {
      return true;
    }
    if (contentTypeHeader.startsWith("text/")) {
      return true;
    }
    return false;
  };
}

export class LazyWaitForEventStep extends BaseLazyStep<WaitStepResponse> {
  private readonly eventId: string;
  private readonly timeout: string;
  stepType: StepType = "Wait";
  protected allowUndefinedOut = false;

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

  protected safeParseOut(out: string): WaitStepResponse {
    const result = JSON.parse(out) as WaitStepResponse;
    return {
      ...result,
      eventData: BaseLazyStep.tryParsing(result.eventData),
    };
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

  protected safeParseOut(out: string): NotifyStepResponse {
    const result = JSON.parse(out) as NotifyStepResponse;
    return {
      ...result,
      eventData: BaseLazyStep.tryParsing(result.eventData),
    };
  }
}

export class LazyInvokeStep<TResult = unknown, TBody = unknown> extends BaseLazyStep<
  InvokeStepResponse<TResult>
> {
  stepType: StepType = "Invoke";
  params: RequiredExceptFields<LazyInvokeStepParams<TBody, TResult>, "retries" | "flowControl">;
  protected allowUndefinedOut = false;

  constructor(
    stepName: string,
    {
      workflow,
      body,
      headers = {},
      workflowRunId,
      retries,
      flowControl,
    }: LazyInvokeStepParams<TBody, TResult>
  ) {
    super(stepName);
    this.params = {
      workflow,
      body,
      headers,
      workflowRunId: getWorkflowRunId(workflowRunId),
      retries,
      flowControl,
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

  protected safeParseOut(out: string): InvokeStepResponse<TResult> {
    const result = JSON.parse(out) as InvokeStepResponse<TResult>;
    return {
      ...result,
      body: BaseLazyStep.tryParsing(result.body),
    };
  }
}
