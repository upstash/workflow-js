import { Telemetry } from "./types";

export const WORKFLOW_ID_HEADER = "Upstash-Workflow-RunId";
export const WORKFLOW_INIT_HEADER = "Upstash-Workflow-Init";
export const WORKFLOW_URL_HEADER = "Upstash-Workflow-Url";
export const WORKFLOW_FAILURE_HEADER = "Upstash-Workflow-Is-Failure";
export const WORKFLOW_FEATURE_HEADER = "Upstash-Feature-Set";
export const WORKFLOW_INVOKE_COUNT_HEADER = "Upstash-Workflow-Invoke-Count";

export const WORKFLOW_PROTOCOL_VERSION = "1";
export const WORKFLOW_PROTOCOL_VERSION_HEADER = "Upstash-Workflow-Sdk-Version";

export const DEFAULT_CONTENT_TYPE = "application/json";

export const NO_CONCURRENCY = 1;
export const NOT_SET = "not-set";
export const DEFAULT_RETRIES = 3;

export const VERSION = "v0.2.7";
export const SDK_TELEMETRY = `@upstash/workflow@${VERSION}`;

export const TELEMETRY_HEADER_SDK = "Upstash-Telemetry-Sdk" as const;
export const TELEMETRY_HEADER_FRAMEWORK = "Upstash-Telemetry-Framework" as const;
export const TELEMETRY_HEADER_RUNTIME = "Upstash-Telemetry-Runtime" as const;
export const TELEMETRY_HEADER_AGENT = "Upstash-Telemetry-Agent" as const;

export const MOCK_TELEMETRY: Telemetry = {
  framework: "mock",
  sdk: "mock",
};
