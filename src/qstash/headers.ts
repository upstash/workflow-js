// class WorkflowHeaders {
//   private headers: Headers;
//   constructor({ initHeaderValue, workflowRunId, workflowUrl, userHeaders }) {
//     const contentType = (this.headers = new Headers() as Headers);
//   }

import { FlowControl, QstashError } from "@upstash/qstash";
import {
  DEFAULT_CONTENT_TYPE,
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
  invokeCount: number;
  initHeaderValue: "true" | "false";
  stepInfo?: StepInfo;
};

class WorkflowHeaders {
  private userHeaders: Headers;
  private workflowConfig: WorkflowConfig;
  private invokeCount: number;
  private initHeaderValue: "true" | "false";
  private stepInfo?: Required<StepInfo>;
  private headers: WorkflowHeaderGroups;

  constructor({
    userHeaders,
    workflowConfig,
    invokeCount,
    initHeaderValue,
    stepInfo,
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
  }

  getHeaders(): HeadersResponse {
    this.addBaseHeaders();
    this.addRetries();
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
      [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody",
      [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
      ...(this.workflowConfig.telemetry ? getTelemetryHeaders(this.workflowConfig.telemetry) : {}),
    };

    if (this.stepInfo?.lazyStep.stepType !== "Call") {
      this.headers.rawHeaders[`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`] =
        WORKFLOW_PROTOCOL_VERSION;
    }
  }

  private addInvokeCount() {
    const invokeCount = this.invokeCount.toString();

    this.headers.workflowHeaders[`Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = invokeCount;
    // this.headers.failureHeaders.set(`Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`, invokeCount); // TODO

    // for context.call:
    if (this.stepInfo?.lazyStep instanceof LazyCallStep) {
      // this.headers.rawHeaders[`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = invokeCount; // TODO
    }
  }

  private addRetries() {
    if (!this.workflowConfig.retries) {
      return;
    }

    const retries = this.workflowConfig.retries.toString();

    this.headers.workflowHeaders["Retries"] = retries;
    // if (this.workflowConfig.failureUrl) { // TODO
    this.headers.failureHeaders["Retries"] = retries;
    // }
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

    if (this.stepInfo?.lazyStep.stepType !== "Call") {
      this.headers.rawHeaders["Upstash-Failure-Callback"] = this.workflowConfig.failureUrl;
    }

    this.headers.failureHeaders[`Forward-${WORKFLOW_FAILURE_HEADER}`] = "true";
    this.headers.failureHeaders[`Forward-Upstash-Workflow-Failure-Callback`] = "true";
    this.headers.failureHeaders["Workflow-Runid"] = this.workflowConfig.workflowRunId;
    this.headers.failureHeaders["Workflow-Init"] = "false";
    this.headers.failureHeaders["Workflow-Url"] = this.workflowConfig.workflowUrl;
    this.headers.failureHeaders["Workflow-Calltype"] = "failureCall";
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
    return {
      headers: {
        ...rawHeaders,
        ...addPrefixToHeaders(
          workflowHeaders,
          this.stepInfo?.lazyStep.stepType === "Call" ? "Upstash-Callback-" : "Upstash-"
        ),
        ...addPrefixToHeaders(failureHeaders, "Upstash-Failure-Callback-"),
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

const prepareFlowControl = (flowControl: FlowControl) => {
  const parallelism = flowControl.parallelism?.toString();
  const rate = flowControl.ratePerSecond?.toString();

  const controlValue = [
    parallelism ? `parallelism=${parallelism}` : undefined,
    rate ? `rate=${rate}` : undefined,
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
