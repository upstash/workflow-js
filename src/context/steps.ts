import type { Client, FlowControl, HTTPMethods } from "@upstash/qstash";
import type {
  CallResponse,
  HeaderParams,
  InvokeStepResponse,
  InvokeWorkflowRequest,
  LazyInvokeStepParams,
  NotifyStepResponse,
  RequiredExceptFields,
  Step,
  StepFunction,
  StepType,
  WaitRequest,
  WaitStepResponse,
} from "../types";
import { makeNotifyRequest } from "../client/utils";
import type { Duration } from "../types";
import { WorkflowError } from "../error";
import { getWorkflowRunId } from "../utils";
import { WorkflowContext } from "./context";
import { getHeaders, prepareFlowControl } from "../qstash/headers";
import { WORKFLOW_FEATURE_HEADER, WORKFLOW_INIT_HEADER, WORKFLOW_URL_HEADER } from "../constants";
import { getTelemetryHeaders, HeadersResponse } from "../workflow-requests";

type StepParams = { context: WorkflowContext } & Pick<HeaderParams, "telemetry"> &
  Required<Pick<HeaderParams, "step" | "invokeCount">>;
type GetHeaderParams = StepParams;
type GetBodyParams = StepParams & Omit<HeadersResponse, "contentType">;
type SubmitStepParams = StepParams &
  Pick<HeadersResponse, "headers"> & { body: string; isParallel: boolean };

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
    if (typeof stepName !== "string") {
      // when updating this warning as error, don't forget to enable to corresponding test
      // in steps.test.ts. If possible, should be changed together with other deprecations
      // if a major version is released
      console.warn(
        "Workflow Warning: A workflow step name must be a string. In a future release, this will throw an error."
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

  getBody({ step }: GetBodyParams): string {
    step.out = JSON.stringify(step.out);
    return JSON.stringify(step);
  }

  getHeaders({ context, telemetry, invokeCount, step }: GetHeaderParams): HeadersResponse {
    return getHeaders({
      initHeaderValue: "false",
      workflowConfig: {
        workflowRunId: context.workflowRunId,
        workflowUrl: context.url,
        failureUrl: context.failureUrl,
        retries: context.retries,
        retryDelay: context.retryDelay,
        useJSONContent: false,
        telemetry,
        flowControl: context.flowControl,
      },
      userHeaders: context.headers,
      invokeCount,
      stepInfo: {
        step,
        lazyStep: this,
      },
    });
  }

  async submitStep({ context, body, headers }: SubmitStepParams) {
    return (await context.qstashClient.batch([
      {
        body,
        headers,
        method: "POST",
        url: context.url,
      },
    ])) as { messageId: string }[];
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

  async submitStep({ context, body, headers, isParallel }: SubmitStepParams) {
    return (await context.qstashClient.batch([
      {
        body,
        headers,
        method: "POST",
        url: context.url,
        delay: isParallel ? undefined : this.sleep,
      },
    ])) as { messageId: string }[];
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

  async submitStep({ context, body, headers, isParallel }: SubmitStepParams) {
    return (await context.qstashClient.batch([
      {
        body,
        headers,
        method: "POST",
        url: context.url,
        notBefore: isParallel ? undefined : this.sleepUntil,
      },
    ])) as { messageId: string }[];
  }
}

export class LazyCallStep<TResult = unknown, TBody = unknown> extends BaseLazyStep<
  CallResponse<TResult>
> {
  private readonly url: string;
  private readonly method: HTTPMethods;
  private readonly body: TBody;
  public readonly headers: Record<string, string>;
  public readonly retries: number;
  public readonly retryDelay?: string;
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
    retryDelay: string | undefined,
    timeout: number | Duration | undefined,
    flowControl: FlowControl | undefined
  ) {
    super(stepName);
    this.url = url;
    this.method = method;
    this.body = body;
    this.headers = headers;
    this.retries = retries;
    this.retryDelay = retryDelay;
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

  private static applicationContentTypes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
    "application/xhtml+xml",
    "application/ld+json",
    "application/rss+xml",
    "application/atom+xml",
  ];

  private static isText = (contentTypeHeader: string | null) => {
    if (!contentTypeHeader) {
      return false;
    }
    if (LazyCallStep.applicationContentTypes.some((type) => contentTypeHeader.includes(type))) {
      return true;
    }
    if (contentTypeHeader.startsWith("text/")) {
      return true;
    }
    return false;
  };

  public getBody({ step }: GetBodyParams): string {
    if (!step.callUrl) {
      throw new WorkflowError("Incompatible step received in LazyCallStep.getBody");
    }

    return JSON.stringify(step.callBody);
  }

  getHeaders({ context, telemetry, invokeCount, step }: GetHeaderParams): HeadersResponse {
    const { headers, contentType } = super.getHeaders({ context, telemetry, invokeCount, step });

    headers["Upstash-Retries"] = this.retries.toString();
    if (this.retryDelay) {
      headers["Upstash-Retry-Delay"] = this.retryDelay;
    }
    headers[WORKFLOW_FEATURE_HEADER] = "WF_NoDelete,InitialBody";

    if (this.flowControl) {
      const { flowControlKey, flowControlValue } = prepareFlowControl(this.flowControl);

      headers["Upstash-Flow-Control-Key"] = flowControlKey;
      headers["Upstash-Flow-Control-Value"] = flowControlValue;
    }

    if (this.timeout) {
      headers["Upstash-Timeout"] = this.timeout.toString();
    }

    const forwardedHeaders = Object.fromEntries(
      Object.entries(this.headers).map(([header, value]) => [`Upstash-Forward-${header}`, value])
    );

    return {
      headers: {
        ...headers,
        ...forwardedHeaders,

        "Upstash-Callback": context.url,
        "Upstash-Callback-Workflow-RunId": context.workflowRunId,
        "Upstash-Callback-Workflow-CallType": "fromCallback",
        "Upstash-Callback-Workflow-Init": "false",
        "Upstash-Callback-Workflow-Url": context.url,
        "Upstash-Callback-Feature-Set": "LazyFetch,InitialBody",

        "Upstash-Callback-Forward-Upstash-Workflow-Callback": "true",
        "Upstash-Callback-Forward-Upstash-Workflow-StepId": step.stepId.toString(),
        "Upstash-Callback-Forward-Upstash-Workflow-StepName": this.stepName,
        "Upstash-Callback-Forward-Upstash-Workflow-StepType": this.stepType,
        "Upstash-Callback-Forward-Upstash-Workflow-Concurrent": step.concurrent.toString(),
        "Upstash-Callback-Forward-Upstash-Workflow-ContentType": contentType,
        "Upstash-Workflow-CallType": "toCallback",
      },
      contentType,
    };
  }

  async submitStep({ context, headers }: SubmitStepParams) {
    return (await context.qstashClient.batch([
      {
        headers,
        body: JSON.stringify(this.body),
        method: this.method,
        url: this.url,
      },
    ])) as { messageId: string }[];
  }
}

export class LazyWaitForEventStep<TEventData> extends BaseLazyStep<WaitStepResponse<TEventData>> {
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

  public async getResultStep(
    concurrent: number,
    stepId: number
  ): Promise<Step<WaitStepResponse<TEventData>>> {
    return await Promise.resolve({
      stepId,
      stepName: this.stepName,
      stepType: this.stepType,
      waitEventId: this.eventId,
      timeout: this.timeout,
      concurrent,
    });
  }

  protected safeParseOut(out: string): WaitStepResponse<TEventData> {
    const result = JSON.parse(out) as WaitStepResponse;
    return {
      ...result,
      eventData: BaseLazyStep.tryParsing(result.eventData),
    };
  }

  public getHeaders({ context, telemetry, invokeCount, step }: GetHeaderParams): HeadersResponse {
    const headers = super.getHeaders({ context, telemetry, invokeCount, step });
    headers.headers["Upstash-Workflow-CallType"] = "step";
    return headers;
  }

  public getBody({ context, step, headers, telemetry }: GetBodyParams): string {
    if (!step.waitEventId) {
      throw new WorkflowError("Incompatible step received in LazyWaitForEventStep.getBody");
    }

    const timeoutHeaders = {
      // to include user headers:
      ...Object.fromEntries(Object.entries(headers).map(([header, value]) => [header, [value]])),
      // to include telemetry headers:
      ...(telemetry
        ? Object.fromEntries(
            Object.entries(getTelemetryHeaders(telemetry)).map(([header, value]) => [
              header,
              [value],
            ])
          )
        : {}),

      // note: using WORKFLOW_ID_HEADER doesn't work, because Runid -> RunId:
      "Upstash-Workflow-Runid": [context.workflowRunId],
      [WORKFLOW_INIT_HEADER]: ["false"],
      [WORKFLOW_URL_HEADER]: [context.url],
      "Upstash-Workflow-CallType": ["step"],
    };

    const waitBody: WaitRequest = {
      url: context.url,
      timeout: step.timeout,
      timeoutBody: undefined,
      timeoutUrl: context.url,
      timeoutHeaders,
      step: {
        stepId: step.stepId,
        stepType: "Wait",
        stepName: step.stepName,
        concurrent: step.concurrent,
        targetStep: step.targetStep,
      },
    };

    return JSON.stringify(waitBody);
  }

  async submitStep({ context, body, headers }: SubmitStepParams) {
    const result = (await context.qstashClient.http.request({
      path: ["v2", "wait", this.eventId],
      body: body,
      headers,
      method: "POST",
      parseResponseAsJson: false,
    })) as { messageId: string };
    return [result];
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
  params: RequiredExceptFields<
    LazyInvokeStepParams<TBody, TResult>,
    "retries" | "flowControl" | "retryDelay"
  >;
  protected allowUndefinedOut = false;
  /**
   * workflow id of the invoked workflow
   */
  private workflowId: string;

  constructor(
    stepName: string,
    {
      workflow,
      body,
      headers = {},
      workflowRunId,
      retries,
      retryDelay,
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
      retryDelay,
      flowControl,
    };

    const { workflowId } = workflow;
    if (!workflowId) {
      throw new WorkflowError("You can only invoke workflow which has a workflowId");
    }
    this.workflowId = workflowId;
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

  public getBody({ context, step, telemetry, invokeCount }: GetBodyParams): string {
    const { headers: invokerHeaders } = getHeaders({
      initHeaderValue: "false",
      workflowConfig: {
        workflowRunId: context.workflowRunId,
        workflowUrl: context.url,
        failureUrl: context.failureUrl,
        retries: context.retries,
        retryDelay: context.retryDelay,
        telemetry,
        flowControl: context.flowControl,
        useJSONContent: false,
      },
      userHeaders: context.headers,
      invokeCount,
    });
    invokerHeaders["Upstash-Workflow-Runid"] = context.workflowRunId;

    const request: InvokeWorkflowRequest = {
      body: JSON.stringify(this.params.body),
      headers: Object.fromEntries(
        Object.entries(invokerHeaders).map((pairs) => [pairs[0], [pairs[1]]])
      ),
      workflowRunId: context.workflowRunId,
      workflowUrl: context.url,
      step,
    };

    return JSON.stringify(request);
  }

  getHeaders({ context, telemetry, invokeCount }: GetHeaderParams): HeadersResponse {
    const {
      workflow,
      headers = {},
      workflowRunId = getWorkflowRunId(),
      retries,
      retryDelay,
      flowControl,
    } = this.params;
    const newUrl = context.url.replace(/[^/]+$/, this.workflowId);

    const {
      retries: workflowRetries,
      retryDelay: workflowRetryDelay,
      failureFunction,
      failureUrl,
      useJSONContent,
      flowControl: workflowFlowControl,
    } = workflow.options;

    const { headers: triggerHeaders, contentType } = getHeaders({
      initHeaderValue: "true",
      workflowConfig: {
        workflowRunId: workflowRunId,
        workflowUrl: newUrl,
        retries: retries ?? workflowRetries,
        retryDelay: retryDelay ?? workflowRetryDelay,
        telemetry,
        failureUrl: failureFunction ? newUrl : failureUrl,
        flowControl: flowControl ?? workflowFlowControl,
        useJSONContent: useJSONContent ?? false,
      },
      invokeCount: invokeCount + 1,
      userHeaders: new Headers(headers) as Headers,
    });
    triggerHeaders["Upstash-Workflow-Invoke"] = "true";

    return { headers: triggerHeaders, contentType };
  }

  async submitStep({ context, body, headers }: SubmitStepParams) {
    const newUrl = context.url.replace(/[^/]+$/, this.workflowId);
    const result = (await context.qstashClient.publish({
      headers,
      method: "POST",
      body,
      url: newUrl,
    })) as { messageId: string };
    return [result];
  }
}
