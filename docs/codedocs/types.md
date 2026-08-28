---
title: "Types"
description: "Exported TypeScript types and interfaces for Upstash Workflow JS."
---

This page lists the exported types from `src/types.ts`, `src/client/types.ts`, and `src/client/filter-types.ts`. Definitions are shown without comments for brevity, but the structures match the source.

**Core types (`src/types.ts`)**
```typescript
export type WorkflowClient = {
  batch: InstanceType<typeof Client>["batch"];
  batchJSON: InstanceType<typeof Client>["batchJSON"];
  publishJSON: InstanceType<typeof Client>["publishJSON"];
  publish: InstanceType<typeof Client>["publish"];
  http: InstanceType<typeof Client>["http"];
};

export type WorkflowReceiver = {
  verify: InstanceType<typeof Receiver>["verify"];
};

export const StepTypes = [
  "Initial",
  "Run",
  "SleepFor",
  "SleepUntil",
  "Call",
  "Wait",
  "Notify",
  "Invoke",
  "CreateWebhook",
  "WaitForWebhook",
] as const;
export type StepType = (typeof StepTypes)[number];

type ThirdPartyCallFields<TBody = unknown> = {
  callUrl: string;
  callMethod: HTTPMethods;
  callBody: TBody;
  callHeaders: Record<string, string>;
};

type WaitFields = {
  waitEventId: string;
  timeout: string;
  waitTimeout?: boolean;
};

type NotifyFields = {
  notifyEventId?: string;
  eventData?: string;
};

export type Step<TResult = unknown, TBody = unknown> = {
  stepId: number;
  stepName: string;
  stepType: StepType;
  out?: TResult;
  sleepFor?: number | Duration;
  sleepUntil?: number;
  concurrent: number;
  targetStep?: number;
} & (ThirdPartyCallFields<TBody> | { [P in keyof ThirdPartyCallFields]?: never }) &
  (WaitFields | { [P in keyof WaitFields]?: never }) &
  (NotifyFields | { [P in keyof NotifyFields]?: never });

export type RawStep = {
  messageId: string;
  body: string;
  callType: "step" | "toCallback" | "fromCallback";
};

export type SyncStepFunction<TResult> = () => TResult;
export type AsyncStepFunction<TResult> = () => Promise<TResult>;
export type StepFunction<TResult> = AsyncStepFunction<TResult> | SyncStepFunction<TResult>;

export type ParallelCallState = "first" | "partial" | "discard" | "last";

export type RouteFunction<TInitialPayload, TResult = unknown> = (
  context: WorkflowContext<TInitialPayload>
) => Promise<TResult>;

export type FinishCondition =
  | "success"
  | "duplicate-step"
  | "fromCallback"
  | "auth-fail"
  | "failure-callback-executed"
  | "failure-callback-undefined"
  | "workflow-already-ended"
  | WorkflowNonRetryableError;

export type DetailedFinishCondition =
  | {
      condition: Exclude<FinishCondition, WorkflowNonRetryableError | "failure-callback-executed">;
      result?: never;
    }
  | {
      condition: "non-retryable-error";
      result: WorkflowNonRetryableError;
    }
  | {
      condition: "retry-after-error";
      result: WorkflowRetryAfterError;
    }
  | {
      condition: "failure-callback-executed";
      result: string | void;
    };

type WorkflowContextWithoutMethods<TInitialPayload> = Omit<
  WorkflowContext<TInitialPayload>,
  | "run"
  | "sleepUntil"
  | "sleep"
  | "call"
  | "waitForEvent"
  | "notify"
  | "cancel"
  | "api"
  | "invoke"
  | "createWebhook"
  | "waitForWebhook"
>;

export type QStashClientExtraConfig = Omit<
  NonNullable<ConstructorParameters<typeof Client>[0]>,
  "baseUrl" | "token"
>;

export type WorkflowServeOptions<TInitialPayload = unknown, TResult = unknown> = {
  qstashClient?: WorkflowClient | QStashClientExtraConfig;
  url?: string;
  receiver?: WorkflowReceiver;
  failureFunction?: (failureData: {
    context: WorkflowContextWithoutMethods<TInitialPayload>;
    failStatus: number;
    failResponse: string;
    failHeaders: Record<string, string[]>;
    failStack: string;
  }) => Promise<void | string> | void | string;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  disableTelemetry?: boolean;
  middlewares?: WorkflowMiddleware<TInitialPayload, TResult>[];
  verbose?: boolean;
} & ExclusiveValidationOptions<TInitialPayload>;

export type ExclusiveValidationOptions<TInitialPayload> =
  | { schema?: z.ZodType<TInitialPayload>; initialPayloadParser?: never }
  | { schema?: never; initialPayloadParser?: (initialPayload: string) => TInitialPayload };

export type Telemetry = { sdk: string; framework?: string; runtime?: string };

export type FailureFunctionPayload = { error: string; message: string; stack?: string };

export type RequiredExceptFields<T, K extends keyof T> = Omit<Required<T>, K> & Partial<Pick<T, K>>;

export type Waiter = {
  url: string;
  deadline: number;
  headers: Record<string, string[]>;
  timeoutUrl?: string;
  timeoutBody?: unknown;
  timeoutHeaders?: Record<string, string[]>;
};

export type NotifyResponse = { waiter: Waiter; messageId: string; error: string };

export type WaitRequest = {
  url: string;
  step: Step;
  timeout: string;
  timeoutUrl?: string;
  timeoutBody?: string;
  timeoutHeaders?: Record<string, string[]>;
};

export type WaitStepResponse<TEventData = unknown> = {
  timeout: boolean;
  eventData: TEventData;
};

export type NotifyStepResponse = {
  eventId: string;
  eventData: unknown;
  notifyResponse: NotifyResponse[];
};

export type CallResponse<TResult = unknown> = {
  status: number;
  body: TResult;
  header: Record<string, string[]>;
};

export type Duration = `${bigint}${"s" | "m" | "h" | "d"}`;

export interface WaitEventOptions {
  timeout?: number | Duration;
}

export type CallSettings = {
  url: string;
  method?: HTTPMethods;
  body?: string;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: string;
  timeout?: Duration | number;
  flowControl?: FlowControl;
};

export type HeaderParams = {
  initHeaderValue: "true" | "false";
  workflowRunId: string;
  workflowUrl: string;
  userHeaders?: Headers;
  telemetry?: Telemetry;
  invokeCount?: number;
} & (
  | { step: Step; callRetries?: number; callRetryDelay?: string; callTimeout?: number | Duration; callFlowControl?: FlowControl }
  | { step?: never; callRetries?: never; callRetryDelay?: never; callTimeout?: never; callFlowControl?: never }
);

export type InvokeWorkflowRequest = {
  workflowUrl: string;
  workflowRunId: string;
  workflowRunCreatedAt: number;
  headers: Record<string, string[]>;
  step: Step;
  body?: string;
};

export type LazyInvokeStepParams<TInitiaPayload, TResult> = {
  workflow: InvokableWorkflow<TInitiaPayload, TResult>;
  workflowRunId?: string;
  label?: string;
} & Pick<CallSettings, "retries" | "headers" | "flowControl" | "retryDelay"> &
  (TInitiaPayload extends undefined ? { body?: undefined } : { body: TInitiaPayload });

export type InvokeStepResponse<TBody> = {
  body: TBody;
  isCanceled?: boolean;
  isFailed?: boolean;
};

export type InvokableWorkflow<TInitialPayload, TResult> = {
  routeFunction: RouteFunction<TInitialPayload, TResult>;
  options: WorkflowServeOptions<TInitialPayload, TResult>;
  workflowId?: string;
  useJSONContent?: boolean;
};
```

**Client types (`src/client/types.ts`)**
```typescript
type BaseStepLog = {
  stepId?: number;
  stepName: string;
  stepType: StepType;
  callType: RawStep["callType"];
  messageId: string;
  out: unknown;
  retries: number;
  retryDelay?: string;
  concurrent: number;
  state: "STEP_PROGRESS" | "STEP_SUCCESS" | "STEP_RETRY" | "STEP_FAILED";
  createdAt: number;
  headers: Record<string, string[]>;
};

type CallUrlGroup = {
  callUrl: string;
  callMethod: HTTPMethods;
  callHeaders: Record<string, string[]>;
  callBody: unknown;
};

type CallResponseStatusGroup = {
  callResponseStatus: number;
  callResponseBody: unknown;
  callResponseHeaders: Record<string, string[]>;
} & CallUrlGroup;

type InvokedWorkflowGroup = {
  invokedWorkflowRunId: string;
  invokedWorkflowUrl: string;
  invokedWorkflowCreatedAt: number;
  invokedWorkflowRunBody: unknown;
  invokedWorkflowRunHeaders: Record<string, string[]>;
};

type WaitEventGroup = {
  waitEventId: string;
  waitTimeoutDuration: string;
  waitTimeoutDeadline: number;
  waitTimeout: boolean;
};

type AsOptional<TType> = TType | { [P in keyof TType]?: never };

export type StepLog = BaseStepLog &
  AsOptional<CallUrlGroup> &
  AsOptional<CallResponseStatusGroup> &
  AsOptional<InvokedWorkflowGroup> &
  AsOptional<{ sleepFor: number }> &
  AsOptional<{ sleepUntil: number }> &
  AsOptional<WaitEventGroup>;

export type StepError = {
  error: string;
  body: string;
  headers: Record<string, string[]>;
  status: number;
  time: number;
};

type StepLogGroup =
  | { steps: [StepLog]; type: "sequential" }
  | { steps: StepLog[]; type: "parallel" }
  | {
      steps: {
        messageId: string;
        state: "STEP_PROGRESS" | "STEP_RETRY" | "STEP_FAILED" | "STEP_CANCELED";
        retries: number;
        retryDelay?: string;
        errors?: StepError[];
      }[];
      type: "next";
    };

type FailureFunctionLog = {
  messageId: string;
  url: string;
  state: "CALLBACK_INPROGRESS" | "CALLBACK_SUCCESS" | "CALLBACK_FAIL";
  failHeaders: Record<string, string[]>;
  failStatus: number;
  failResponse: string;
  dlqId: string;
  errors?: StepError[];
  responseBody?: string;
  responseHeaders?: Record<string, string[]>;
  responseStatus?: number;
};

export type WorkflowRunLog = {
  workflowRunId: string;
  workflowUrl: string;
  workflowState: "RUN_STARTED" | "RUN_SUCCESS" | "RUN_FAILED" | "RUN_CANCELED";
  workflowRunCreatedAt: number;
  workflowRunCompletedAt?: number;
  failureFunction?: FailureFunctionLog;
  steps: StepLogGroup[];
  workflowRunResponse?: string;
  invoker?: {
    workflowRunId: string;
    workflowUrl: string;
    workflowRunCreatedAt: number;
  };
  dlqId?: string;
  label?: string;
};

export type WorkflowRunLogs = {
  cursor: string;
  runs: WorkflowRunLog[];
};

export type TriggerOptions = {
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  workflowRunId?: string;
  retries?: number;
  retryDelay?: string;
  flowControl?: FlowControl;
  delay?: PublishRequest["delay"];
  notBefore?: PublishRequest["notBefore"];
  label?: string;
  disableTelemetry?: boolean;
  failureUrl?: string;
  redact?: { body?: true; header?: true | string[] };
};

export type DLQResumeRestartOptions<TDLQId extends string | string[] = string | string[]> = {
  dlqId: TDLQId;
} & Pick<TriggerOptions, "flowControl" | "retries">;

export type DLQResumeRestartResponse = {
  workflowRunId: string;
  workflowCreatedAt: string;
};
```

**Filter types (`src/client/filter-types.ts`)**
```typescript
type RequireAtLeastOne<T> = { [K in keyof T]-?: Required<Pick<T, K>> }[keyof T];

type UniversalFilterFields = {
  fromDate?: Date | number;
  toDate?: Date | number;
  callerIp?: string;
  label?: string;
  flowControlKey?: string;
};

type WorkflowFilterFields = {
  workflowUrl?: string;
  workflowRunId?: string;
  workflowCreatedAt?: number;
  failureFunctionState?: string;
};

type WorkflowLogsFilterFields = {
  state?: WorkflowRunLog["workflowState"];
  messageId?: string;
};

type DLQActionFilterFields = UniversalFilterFields & WorkflowFilterFields;

type CancelFilterWithExactUrl = UniversalFilterFields & {
  workflowUrl: string;
  workflowUrlStartingWith?: never;
};

type CancelFilterWithPrefixUrl = UniversalFilterFields & {
  workflowUrlStartingWith: string;
  workflowUrl?: never;
};

type CancelFilterWithoutUrl = RequireAtLeastOne<UniversalFilterFields> & {
  workflowUrl?: never;
  workflowUrlStartingWith?: never;
};

type CancelFilter = CancelFilterWithExactUrl | CancelFilterWithPrefixUrl | CancelFilterWithoutUrl;

type WorkflowDLQBulkCount = {
  cursor?: string;
  count?: number;
};

export type WorkflowDLQActionFilters =
  | { dlqIds: string | string[]; filter?: never; all?: never; count?: never; cursor?: never }
  | ({ filter: RequireAtLeastOne<DLQActionFilterFields>; dlqIds?: never; all?: never } & WorkflowDLQBulkCount)
  | ({ all: true; dlqIds?: never; filter?: never } & WorkflowDLQBulkCount);

export type WorkflowDLQListFilters = UniversalFilterFields &
  WorkflowFilterFields & {
    url?: string;
    responseStatus?: number;
  };

type WorkflowCancelCount = {
  count?: number;
};

export type WorkflowRunCancelFilters =
  | { workflowRunIds: string[]; filter?: never; all?: never; count?: never }
  | ({ filter: CancelFilter; workflowRunIds?: never; all?: never } & WorkflowCancelCount)
  | ({ all: true; workflowRunIds?: never; filter?: never } & WorkflowCancelCount);

export type WorkflowLogsListFilters = UniversalFilterFields &
  Pick<WorkflowFilterFields, "workflowUrl" | "workflowRunId" | "workflowCreatedAt"> &
  WorkflowLogsFilterFields;
```
