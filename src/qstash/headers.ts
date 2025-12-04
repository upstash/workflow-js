import { FlowControl, QstashError } from "@upstash/qstash";
import {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_RETRIES,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_FEATURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "../constants";
import { BaseLazyStep, LazyCallStep } from "../context/steps";
import { Step, Telemetry } from "../types";
import { getTelemetryHeaders, HeadersResponse } from "../workflow-requests";

export type WorkflowConfig = {
  retries?: number;
  retryDelay?: string;
  flowControl?: FlowControl;
  failureUrl?: string;
  telemetry?: Telemetry;
  workflowRunId: string;
  workflowUrl: string;
  useJSONContent?: boolean;
};

/**
 * groups the headers with respect to where they should be passed
 */
type WorkflowHeaderGroups = {
  /**
   * headers which will be returned as they are, without any prefix
   */
  rawHeaders: Record<string, string>;
  /**
   * headers which should be passed to the workflow endpoint
   *
   * will be prefixed with `Upstash-` or `Upstash-Callback` depending on the step
   */
  workflowHeaders: Record<string, string>;
  /**
   * Headers which should be passed to the failure URL
   *
   * will be prefixed with `Upstash-Failure-Callback-`
   */
  failureHeaders: Record<string, string>;
};

type StepInfo = {
  step: Step;
  lazyStep: BaseLazyStep;
};

type WorkflowHeaderParams = {
  userHeaders: Headers;
  workflowConfig: WorkflowConfig;
  invokeCount?: number;
  initHeaderValue: "true" | "false";
  stepInfo?: StepInfo;
  keepTriggerConfig?: boolean;
};

class WorkflowHeaders {
  private userHeaders: Headers;
  private workflowConfig: WorkflowConfig;
  private invokeCount?: number;
  private initHeaderValue: "true" | "false";
  private stepInfo?: Required<StepInfo>;
  private headers: WorkflowHeaderGroups;
  private keepTriggerConfig?: boolean;

  constructor({
    userHeaders,
    workflowConfig,
    invokeCount,
    initHeaderValue,
    stepInfo,
    keepTriggerConfig,
  }: WorkflowHeaderParams) {
    this.userHeaders = userHeaders;
    this.workflowConfig = workflowConfig;
    this.invokeCount = invokeCount;
    this.initHeaderValue = initHeaderValue;
    this.stepInfo = stepInfo;
    this.headers = {
      rawHeaders: {},
      workflowHeaders: {},
      failureHeaders: {},
    };
    this.keepTriggerConfig = keepTriggerConfig;
  }

  getHeaders(): HeadersResponse {
    this.addBaseHeaders();
    this.addRetries();
    this.addRetryDelay();
    this.addFlowControl();
    this.addUserHeaders();
    this.addInvokeCount();
    this.addFailureUrl();
    const contentType = this.addContentType();

    return this.prefixHeaders(contentType);
  }

  private addBaseHeaders() {
    this.headers.rawHeaders = {
      ...this.headers.rawHeaders,
      [WORKFLOW_INIT_HEADER]: this.initHeaderValue,
      [WORKFLOW_ID_HEADER]: this.workflowConfig.workflowRunId,
      [WORKFLOW_URL_HEADER]: this.workflowConfig.workflowUrl,
      [WORKFLOW_FEATURE_HEADER]:
        "LazyFetch,InitialBody,WF_DetectTrigger" +
        (this.keepTriggerConfig ? ",WF_TriggerOnConfig" : ""),
      [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
      ...(this.workflowConfig.telemetry ? getTelemetryHeaders(this.workflowConfig.telemetry) : {}),
    };

    if (this.stepInfo?.lazyStep.stepType !== "Call") {
      this.headers.rawHeaders[`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`] =
        WORKFLOW_PROTOCOL_VERSION;
    }
  }

  private addInvokeCount() {
    if (this.invokeCount === undefined || this.invokeCount === 0) {
      return;
    }
    const invokeCount = this.invokeCount.toString();

    this.headers.workflowHeaders[`Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = invokeCount;
    if (this.workflowConfig.failureUrl) {
      this.headers.failureHeaders[`Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = invokeCount;
    }

    // for context.call:
    if (this.stepInfo?.lazyStep instanceof LazyCallStep) {
      this.headers.rawHeaders[`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = invokeCount;
    }
  }

  private addRetries() {
    if (
      this.workflowConfig.retries === undefined ||
      this.workflowConfig.retries === DEFAULT_RETRIES
    ) {
      return;
    }

    const retries = this.workflowConfig.retries.toString();

    this.headers.workflowHeaders["Retries"] = retries;
    if (this.workflowConfig.failureUrl) {
      this.headers.failureHeaders["Retries"] = retries;
    }
  }

  private addRetryDelay() {
    if (this.workflowConfig.retryDelay === undefined || this.workflowConfig.retryDelay === "") {
      return;
    }

    const retryDelay = this.workflowConfig.retryDelay.toString();

    this.headers.workflowHeaders["Retry-Delay"] = retryDelay;
    if (this.workflowConfig.failureUrl) {
      this.headers.failureHeaders["Retry-Delay"] = retryDelay;
    }
  }

  private addFlowControl() {
    if (!this.workflowConfig.flowControl) {
      return;
    }
    const { flowControlKey, flowControlValue } = prepareFlowControl(
      this.workflowConfig.flowControl
    );

    this.headers.workflowHeaders["Flow-Control-Key"] = flowControlKey;
    this.headers.workflowHeaders["Flow-Control-Value"] = flowControlValue;

    if (this.workflowConfig.failureUrl) {
      this.headers.failureHeaders["Flow-Control-Key"] = flowControlKey;
      this.headers.failureHeaders["Flow-Control-Value"] = flowControlValue;
    }
  }

  private addUserHeaders() {
    for (const [key, value] of this.userHeaders.entries()) {
      const forwardKey = `Forward-${key}`;
      this.headers.workflowHeaders[forwardKey] = value;

      if (this.workflowConfig.failureUrl) {
        this.headers.failureHeaders[forwardKey] = value;
      }
    }
  }

  private addFailureUrl() {
    if (!this.workflowConfig.failureUrl) {
      return;
    }

    this.headers.workflowHeaders["Failure-Callback"] = this.workflowConfig.failureUrl;

    this.headers.failureHeaders[`Forward-${WORKFLOW_FAILURE_HEADER}`] = "true";
    this.headers.failureHeaders[`Forward-Upstash-Workflow-Failure-Callback`] = "true";
    this.headers.failureHeaders["Workflow-Runid"] = this.workflowConfig.workflowRunId;
    this.headers.failureHeaders["Workflow-Init"] = "false";
    this.headers.failureHeaders["Workflow-Url"] = this.workflowConfig.workflowUrl;
    this.headers.failureHeaders["Workflow-Calltype"] = "failureCall";
    this.headers.failureHeaders["Feature-Set"] = "LazyFetch,InitialBody,WF_DetectTrigger";
    if (
      this.workflowConfig.retries !== undefined &&
      this.workflowConfig.retries !== DEFAULT_RETRIES
    ) {
      this.headers.failureHeaders["Retries"] = this.workflowConfig.retries.toString();
    }
    if (this.workflowConfig.retryDelay !== undefined && this.workflowConfig.retryDelay !== "") {
      this.headers.failureHeaders["Retry-Delay"] = this.workflowConfig.retryDelay.toString();
    }
  }

  private addContentType() {
    if (this.workflowConfig.useJSONContent) {
      this.headers.rawHeaders["content-type"] = "application/json";
      return "application/json";
    }

    const callHeaders = new Headers(
      this.stepInfo?.lazyStep instanceof LazyCallStep ? this.stepInfo.lazyStep.headers : {}
    );
    const contentType =
      (callHeaders.get("content-type")
        ? callHeaders.get("content-type")
        : this.userHeaders?.get("Content-Type")
          ? this.userHeaders.get("Content-Type")
          : undefined) ?? DEFAULT_CONTENT_TYPE;
    this.headers.rawHeaders["content-type"] = contentType;
    return contentType;
  }

  private prefixHeaders(contentType: string): HeadersResponse {
    const { rawHeaders, workflowHeaders, failureHeaders } = this.headers;

    const isCall = this.stepInfo?.lazyStep.stepType === "Call";
    return {
      headers: {
        ...rawHeaders,
        ...addPrefixToHeaders(workflowHeaders, isCall ? "Upstash-Callback-" : "Upstash-"),
        ...addPrefixToHeaders(failureHeaders, "Upstash-Failure-Callback-"),
        ...(isCall ? addPrefixToHeaders(failureHeaders, "Upstash-Callback-Failure-Callback-") : {}),
      },
      contentType,
    };
  }
}

function addPrefixToHeaders(headers: Record<string, string>, prefix: string) {
  const prefixedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    prefixedHeaders[`${prefix}${key}`] = value;
  }
  return prefixedHeaders;
}

export const prepareFlowControl = (flowControl: FlowControl) => {
  const parallelism = flowControl.parallelism?.toString();
  const rate = (flowControl.rate ?? flowControl.ratePerSecond)?.toString();
  const period =
    typeof flowControl.period === "number" ? `${flowControl.period}s` : flowControl.period;

  const controlValue = [
    parallelism ? `parallelism=${parallelism}` : undefined,
    rate ? `rate=${rate}` : undefined,
    period ? `period=${period}` : undefined,
  ].filter(Boolean);

  if (controlValue.length === 0) {
    throw new QstashError("Provide at least one of parallelism or ratePerSecond for flowControl");
  }

  return {
    flowControlKey: flowControl.key,
    flowControlValue: controlValue.join(", "),
  };
};

export const getHeaders = (params: WorkflowHeaderParams) => {
  const workflowHeaders = new WorkflowHeaders(params);
  return workflowHeaders.getHeaders();
};
