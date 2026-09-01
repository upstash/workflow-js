import { FlowControl, QstashError } from "@upstash/qstash";
import {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_RETRIES,
  FLOW_CONTROL_KEY_HEADER,
  FLOW_CONTROL_VALUE_HEADER,
  RETRIES_HEADER,
  RETRY_DELAY_HEADER,
  WORKFLOW_FAILURE_CALLBACK_HEADER,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_FEATURE_HEADER,
  WORKFLOW_FEATURE_SET,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_STEP_CONFIG_FEATURE,
  WORKFLOW_URL_HEADER,
} from "../constants";
import { BaseLazyStep, LazyCallStep } from "../context/steps";
import { Step, StepSettings, Telemetry } from "../types";
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
  /**
   * headers carrying step-level settings.
   *
   * Returned as they are, and applied last so that they win over the
   * settings the run was triggered with, which the groups above carry.
   */
  stepSettingsHeaders: Record<string, string>;
};

type StepInfo = {
  step: Step;
  lazyStep: BaseLazyStep;
};

type WorkflowHeaderParams = {
  userHeaders?: Headers;
  workflowConfig: WorkflowConfig;
  invokeCount?: number;
  initHeaderValue: "true" | "false";
  stepInfo?: StepInfo;
  /**
   * step-level settings to apply to the message being published, so that
   * QStash uses them instead of the settings the run was triggered with.
   */
  stepSettings?: StepSettings;
};

class WorkflowHeaders {
  private userHeaders?: Headers;
  private workflowConfig: WorkflowConfig;
  private invokeCount?: number;
  private initHeaderValue: "true" | "false";
  private stepInfo?: Required<StepInfo>;
  private stepSettings?: StepSettings;
  private headers: WorkflowHeaderGroups;

  /**
   * @param params workflow header parameters
   */
  constructor({
    userHeaders,
    workflowConfig,
    invokeCount,
    initHeaderValue,
    stepInfo,
    stepSettings,
  }: WorkflowHeaderParams) {
    this.userHeaders = userHeaders;
    this.workflowConfig = workflowConfig;
    this.invokeCount = invokeCount;
    this.initHeaderValue = initHeaderValue;
    this.stepInfo = stepInfo;
    this.stepSettings = stepSettings;
    this.headers = {
      rawHeaders: {},
      workflowHeaders: {},
      failureHeaders: {},
      stepSettingsHeaders: {},
    };
  }

  getHeaders(): HeadersResponse {
    this.addBaseHeaders();
    this.addRetries();
    this.addRetryDelay();
    this.addFlowControl();
    this.addUserHeaders();
    this.addInvokeCount();
    this.addFailureUrl();
    this.addStepSettings();
    const contentType = this.addContentType();

    return this.prefixHeaders(contentType);
  }

  private addBaseHeaders() {
    this.headers.rawHeaders = {
      ...this.headers.rawHeaders,
      [WORKFLOW_INIT_HEADER]: this.initHeaderValue,
      [WORKFLOW_ID_HEADER]: this.workflowConfig.workflowRunId,
      [WORKFLOW_URL_HEADER]: this.workflowConfig.workflowUrl,
      [WORKFLOW_FEATURE_HEADER]: WORKFLOW_FEATURE_SET,
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
    if (!this.userHeaders) {
      return;
    }

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
    this.headers.failureHeaders[`Forward-${WORKFLOW_FAILURE_CALLBACK_HEADER}`] = "true";
    this.headers.failureHeaders["Workflow-Runid"] = this.workflowConfig.workflowRunId;
    this.headers.failureHeaders["Workflow-Init"] = "false";
    this.headers.failureHeaders["Workflow-Url"] = this.workflowConfig.workflowUrl;
    this.headers.failureHeaders["Workflow-Calltype"] = "failureCall";
    this.headers.failureHeaders["Feature-Set"] = WORKFLOW_FEATURE_SET;
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

  /**
   * Applies the step-level settings of a step to the message.
   *
   * These headers configure the message itself, so that QStash uses them
   * instead of the settings the run was triggered with. The delivery of
   * the message is what executes the step, which is how a step's
   * settings reach it.
   *
   * When any setting is present the feature set is extended with
   * `WF_StepConfig`, which is what tells QStash to keep them. QStash
   * reports that back on the delivery as `Upstash-Workflow-Step-Config`.
   */
  private addStepSettings() {
    if (!this.stepSettings) {
      return;
    }

    const headers: Record<string, string> = {};

    if (this.stepSettings.flowControl) {
      const { flowControlKey, flowControlValue } = prepareFlowControl(
        this.stepSettings.flowControl
      );
      headers[FLOW_CONTROL_KEY_HEADER] = flowControlKey;
      headers[FLOW_CONTROL_VALUE_HEADER] = flowControlValue;
    }
    if (this.stepSettings.retries !== undefined) {
      headers[RETRIES_HEADER] = this.stepSettings.retries.toString();
    }
    if (this.stepSettings.retryDelay) {
      headers[RETRY_DELAY_HEADER] = this.stepSettings.retryDelay;
    }

    if (Object.keys(headers).length === 0) {
      return;
    }

    headers[WORKFLOW_FEATURE_HEADER] = `${WORKFLOW_FEATURE_SET},${WORKFLOW_STEP_CONFIG_FEATURE}`;
    this.headers.stepSettingsHeaders = headers;
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
    const { rawHeaders, workflowHeaders, failureHeaders, stepSettingsHeaders } = this.headers;

    const isCall = this.stepInfo?.lazyStep.stepType === "Call";
    return {
      headers: {
        ...rawHeaders,
        ...addPrefixToHeaders(workflowHeaders, isCall ? "Upstash-Callback-" : "Upstash-"),
        ...addPrefixToHeaders(failureHeaders, "Upstash-Failure-Callback-"),
        ...(isCall ? addPrefixToHeaders(failureHeaders, "Upstash-Callback-Failure-Callback-") : {}),
        // last, so they override the run's settings above. Never
        // prefixed: they configure this message, not its callback.
        ...stepSettingsHeaders,
      },
      contentType,
    };
  }
}

/**
 * Adds a prefix to all header keys.
 *
 * @param headers headers to prefix
 * @param prefix prefix to add
 */
function addPrefixToHeaders(headers: Record<string, string>, prefix: string) {
  const prefixedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    prefixedHeaders[`${prefix}${key}`] = value;
  }
  return prefixedHeaders;
}

/**
 * Prepares flow control headers from FlowControl object.
 *
 * @param flowControl flow control configuration
 */
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

/**
 * Gets headers for workflow requests.
 *
 * @param params workflow header parameters
 */
export const getHeaders = (params: WorkflowHeaderParams) => {
  const workflowHeaders = new WorkflowHeaders(params);
  return workflowHeaders.getHeaders();
};
