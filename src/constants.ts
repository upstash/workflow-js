import { Telemetry } from "./types";

export const WORKFLOW_ID_HEADER = "Upstash-Workflow-RunId";
export const WORKFLOW_INIT_HEADER = "Upstash-Workflow-Init";
export const WORKFLOW_URL_HEADER = "Upstash-Workflow-Url";
export const WORKFLOW_CREATED_AT_HEADER = "Upstash-Workflow-CreatedAt";
export const WORKFLOW_FAILURE_HEADER = "Upstash-Workflow-Is-Failure";
export const WORKFLOW_FAILURE_CALLBACK_HEADER = "Upstash-Workflow-Failure-Callback";
export const WORKFLOW_FEATURE_HEADER = "Upstash-Feature-Set";
export const WORKFLOW_FEATURE_SET = "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig";
/**
 * header which marks the delivery carrying the result of a
 * `context.invoke` step.
 *
 * Sent by the SDK in the invoker headers of a `context.invoke`
 * submission (as a forwarded header), so that QStash includes it in the
 * request which delivers the invoke result back to the invoker workflow.
 *
 * When the SDK receives a request with this header, it discovers the
 * next step of the workflow before executing it: if the next step has
 * step-level settings, a redelivery with the settings is requested
 * instead of executing the step in the current (ungated) delivery.
 */
export const WORKFLOW_INVOKE_RESULT_HEADER = "Upstash-Workflow-Invoke-Result";
/**
 * call type of the hidden helper request which makes QStash call the
 * workflow endpoint again with step-level settings applied. QStash
 * doesn't treat it as a step and hides it from the step logs.
 */
export const WORKFLOW_DISCOVERY_CALL_TYPE = "discovery";
/**
 * feature added to the feature set of a message which carries step-level
 * settings (flow control, retries etc.). Signals QStash to use the message's
 * own settings instead of the settings the workflow run was triggered with.
 */
export const WORKFLOW_STEP_CONFIG_FEATURE = "WF_StepConfig";
export const WORKFLOW_INVOKE_COUNT_HEADER = "Upstash-Workflow-Invoke-Count";
export const WORKFLOW_RETRIED_HEADER = "Upstash-Retried";
export const WORKFLOW_LABEL_HEADER = "Upstash-Label";
export const WORKFLOW_UNKOWN_SDK_VERSION_HEADER = "Upstash-Workflow-Unknown-Sdk";
export const WORKFLOW_UNKOWN_SDK_TRIGGER_HEADER = "upstash-workflow-trigger-by-sdk";
export const WORKFLOW_ERROR_STEP_NAME_HEADER = "Upstash-Error-Step-Name";

export const WORKFLOW_PROTOCOL_VERSION = "1";
export const WORKFLOW_PROTOCOL_VERSION_HEADER = "Upstash-Workflow-Sdk-Version";

export const DEFAULT_CONTENT_TYPE = "application/json";

export const NO_CONCURRENCY = 1;
export const NOT_SET = "not-set";
export const DEFAULT_RETRIES = 3;

export const VERSION = "v1.3.2";
export const SDK_TELEMETRY = `@upstash/workflow@${VERSION}`;

export const TELEMETRY_HEADER_SDK = "Upstash-Telemetry-Sdk" as const;
export const TELEMETRY_HEADER_FRAMEWORK = "Upstash-Telemetry-Framework" as const;
export const TELEMETRY_HEADER_RUNTIME = "Upstash-Telemetry-Runtime" as const;

export const MOCK_TELEMETRY: Telemetry = {
  framework: "mock",
  sdk: "mock",
};
