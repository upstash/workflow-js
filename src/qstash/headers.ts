import { FlowControl, QstashError } from "@upstash/qstash";
import {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_RETRIES,
  WORKFLOW_FAILURE_CALLBACK_HEADER,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_FEATURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_LABEL_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "../constants";
import { BaseLazyStep, LazyCallStep } from "../context/steps";
import { Step, Telemetry } from "../types";
import { getTelemetryHeaders, HeadersResponse } from "../workflow-requests";
import { TriggerOptions } from "../client/types";
import { serializeLabel } from "../utils";

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
  userHeaders?: Headers;
  workflowConfig: WorkflowConfig;
  invokeCount?: number;
  initHeaderValue: "true" | "false";
  stepInfo?: StepInfo;
};

class WorkflowHeaders {
  private userHeaders?: Headers;
  private workflowConfig: WorkflowConfig;
  private invokeCount?: number;
  private initHeaderValue: "true" | "false";
  private stepInfo?: Required<StepInfo>;
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
      [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
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
    this.headers.failureHeaders["Feature-Set"] =
      "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig";
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

/**
 * Serializes the `redact` option into the value of the `Upstash-Redact-Fields`
 * header. Returns undefined when nothing is to be redacted.
 *
 * @param redact redact configuration
 */
const prepareRedactFields = (redact: TriggerOptions["redact"]) => {
  if (!redact) {
    return;
  }

  const fields: string[] = [];
  if (redact.body) {
    fields.push("body");
  }
  if (redact.header === true) {
    fields.push("header");
  } else if (Array.isArray(redact.header)) {
    for (const header of redact.header) {
      fields.push(`header[${header}]`);
    }
  }

  return fields.length > 0 ? fields.join(",") : undefined;
};

export type TriggerHeaderParams = {
  /**
   * workflow run id of the run to be started. Always sent so that the id
   * returned by `client.trigger` is known before the request is made.
   */
  workflowRunId: string;
  /**
   * URL of the workflow. Only used as the default failure callback.
   */
  workflowUrl: string;
  /**
   * headers of the user, which will be forwarded to the workflow endpoint
   */
  userHeaders?: Headers;
} & Pick<
  TriggerOptions,
  | "retries"
  | "retryDelay"
  | "flowControl"
  | "delay"
  | "notBefore"
  | "failureUrl"
  | "redact"
  | "label"
> & { telemetry?: Telemetry };

/**
 * Builds the headers of a single message of a `/v2/batch/trigger` request.
 *
 * Unlike the publish API, the trigger API fills in the workflow protocol
 * headers itself: the workflow url, the init & calltype flags, the feature
 * set, the headers forwarded to the SDK and the whole failure callback
 * wiring. So we only pass the headers which correspond to an option the
 * caller can actually set.
 *
 * Headers which the server *appends to* rather than overwrites
 * (`Upstash-Failure-Callback-Workflow-*` and the
 * `Upstash-Failure-Callback-Forward-*` headers it derives from
 * `Upstash-Forward-*`) must not be sent here, otherwise they end up with two
 * values.
 *
 * @param params trigger header parameters
 */
export const getTriggerHeaders = ({
  workflowRunId,
  workflowUrl,
  userHeaders,
  label,
  telemetry,
  retries,
  retryDelay,
  flowControl,
  delay,
  notBefore,
  failureUrl,
  redact,
}: TriggerHeaderParams): Headers => {
  const headers = new Headers({
    [WORKFLOW_ID_HEADER]: workflowRunId,
    "content-type": userHeaders?.get("content-type") ?? DEFAULT_CONTENT_TYPE,
    ...(telemetry ? getTelemetryHeaders(telemetry) : {}),
  });

  if (userHeaders) {
    for (const [key, value] of userHeaders.entries()) {
      headers.set(`Upstash-Forward-${key}`, value);
    }
  }

  if (label) {
    headers.set(WORKFLOW_LABEL_HEADER, serializeLabel(label));
  }

  // the failure callback defaults to the workflow url server side, but we set
  // it explicitly so that the failure callback settings below always apply.
  headers.set("Upstash-Failure-Callback", failureUrl ?? workflowUrl);

  if (retries !== undefined && retries !== DEFAULT_RETRIES) {
    headers.set("Upstash-Retries", retries.toString());
    headers.set("Upstash-Failure-Callback-Retries", retries.toString());
  }

  if (retryDelay) {
    headers.set("Upstash-Retry-Delay", retryDelay);
    headers.set("Upstash-Failure-Callback-Retry-Delay", retryDelay);
  }

  if (flowControl) {
    const { flowControlKey, flowControlValue } = prepareFlowControl(flowControl);

    headers.set("Upstash-Flow-Control-Key", flowControlKey);
    headers.set("Upstash-Flow-Control-Value", flowControlValue);
    headers.set("Upstash-Failure-Callback-Flow-Control-Key", flowControlKey);
    headers.set("Upstash-Failure-Callback-Flow-Control-Value", flowControlValue);
  }

  if (notBefore !== undefined) {
    headers.set("Upstash-Not-Before", notBefore.toFixed(0));
  } else if (delay !== undefined) {
    headers.set("Upstash-Delay", typeof delay === "string" ? delay : `${delay.toFixed(0)}s`);
  }

  const redactFields = prepareRedactFields(redact);
  if (redactFields) {
    headers.set("Upstash-Redact-Fields", redactFields);
  }

  return headers;
};
