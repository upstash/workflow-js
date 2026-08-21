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
 * call type of the step config request: a hidden helper request which
 * makes QStash call the workflow endpoint again with step-level settings
 * applied. QStash doesn't treat it as a step and hides it from the step
 * logs.
 *
 * The SDK publishes one when it is about to execute a step which has
 * step-level settings in a delivery which wasn't gated by them.
 */
export const WORKFLOW_STEP_CONFIG_CALL_TYPE = "stepConfig";
/**
 * header which marks a delivery whose message was published with
 * step-level settings.
 *
 * Set by QStash from the message's own feature set, so it cannot
 * disagree with what QStash actually did. Its presence forbids
 * publishing another step config request: if the settings still don't
 * match what the step asked for, the step is executed with the wrong
 * settings (and a warning) instead of looping invisibly.
 */
export const WORKFLOW_STEP_CONFIG_HEADER = "Upstash-Workflow-Step-Config";
/**
 * headers through which QStash reports the configuration it applied to
 * the delivery in hand (the "effective configuration").
 */
export const FLOW_CONTROL_KEY_HEADER = "Upstash-Flow-Control-Key";
export const FLOW_CONTROL_VALUE_HEADER = "Upstash-Flow-Control-Value";
/**
 * sets the retry limit of a message when publishing.
 *
 * Note that on a *delivery* this header means something else — how many
 * retries have already happened — so the limit QStash applied is read
 * from `MAX_RETRIES_HEADER` instead.
 */
export const RETRIES_HEADER = "Upstash-Retries";
/**
 * reports the retry limit QStash applied to the delivery in hand.
 */
export const MAX_RETRIES_HEADER = "Upstash-Max-Retries";
export const RETRY_DELAY_HEADER = "Upstash-Retry-Delay";
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
