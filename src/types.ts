import type { FlowControl, Receiver } from "@upstash/qstash";
import type { Client } from "@upstash/qstash";
import type { HTTPMethods } from "@upstash/qstash";
import type { WorkflowContext } from "./context";
import type { WorkflowLogger } from "./logger";
import { z } from "zod";

/**
 * Interface for Client with required methods
 *
 * Neeeded to resolve import issues
 */
export type WorkflowClient = {
  batchJSON: InstanceType<typeof Client>["batchJSON"];
  publishJSON: InstanceType<typeof Client>["publishJSON"];
  publish: InstanceType<typeof Client>["publish"];
  http: InstanceType<typeof Client>["http"];
};
/**
 * Interface for Receiver with required methods
 *
 * Neeeded to resolve import issues
 */
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
] as const;
export type StepType = (typeof StepTypes)[number];

type ThirdPartyCallFields<TBody = unknown> = {
  /**
   * Third party call URL. Set when context.call is used.
   */
  callUrl: string;
  /**
   * Third party call method. Set when context.call is used.
   */
  callMethod: HTTPMethods;
  /**
   * Third party call body. Set when context.call is used.
   */
  callBody: TBody;
  /**
   * Third party call headers. Set when context.call is used.
   */
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
  /**
   * index of the step
   */
  stepId: number;
  /**
   * name of the step
   */
  stepName: string;
  /**
   * type of the step (Initial/Run/SleepFor/SleepUntil/Call)
   */
  stepType: StepType;
  /**
   * step result. Set if context.run or context.call are used.
   */
  out?: TResult;
  /**
   * sleep duration in seconds. Set when context.sleep is used.
   */
  sleepFor?: number | Duration;
  /**
   * unix timestamp (in seconds) to wait until. Set when context.sleepUntil is used.
   */
  sleepUntil?: number;
  /**
   * number of steps running concurrently if the step is in a parallel run.
   * Set to 1 if step is not parallel.
   */
  concurrent: number;
  /**
   * target step of a plan step. In other words, the step to assign the
   * result of a plan step.
   *
   * undefined if the step is not a plan step (of a parallel run). Otherwise,
   * set to the target step.
   */
  targetStep?: number;
} & (ThirdPartyCallFields<TBody> | { [P in keyof ThirdPartyCallFields]?: never }) &
  (WaitFields | { [P in keyof WaitFields]?: never }) &
  (NotifyFields | { [P in keyof NotifyFields]?: never });

export type RawStep = {
  messageId: string;
  body: string; // body is a base64 encoded step or payload
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
  | "failure-callback"
  | "workflow-already-ended";

export type WorkflowServeOptions<
  TResponse extends Response = Response,
  TInitialPayload = unknown,
> = ValidationOptions<TInitialPayload> & {
  /**
   * QStash client
   */
  qstashClient?: WorkflowClient;
  /**
   * Function called to return a response after each step execution
   *
   * @param workflowRunId
   * @returns response
   */
  onStepFinish?: (workflowRunId: string, finishCondition: FinishCondition) => TResponse;
  /**
   * Url of the endpoint where the workflow is set up.
   *
   * If not set, url will be inferred from the request.
   */
  url?: string;
  /**
   * Verbose mode
   *
   * Disabled if not set. If set to true, a logger is created automatically.
   *
   * Alternatively, a WorkflowLogger can be passed.
   */
  verbose?: WorkflowLogger | true;
  /**
   * Receiver to verify *all* requests by checking if they come from QStash
   *
   * By default, a receiver is created from the env variables
   * QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY if they are set.
   */
  receiver?: WorkflowReceiver;
  /**
   * Url to call if QStash retries are exhausted while executing the workflow
   */
  failureUrl?: string;
  /**
   * Failure function called when QStash retries are exhausted while executing
   * the workflow. Will overwrite `failureUrl` parameter with the workflow
   * endpoint if passed.
   *
   * @param context workflow context at the moment of error
   * @param failStatus error status
   * @param failResponse error message
   * @returns void
   */
  failureFunction?: (failureData: {
    context: Omit<
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
      | "agents"
    >;
    failStatus: number;
    failResponse: string;
    failHeaders: Record<string, string[]>;
  }) => Promise<void> | void;
  /**
   * Base Url of the workflow endpoint
   *
   * Can be used to set if there is a local tunnel or a proxy between
   * QStash and the workflow endpoint.
   *
   * Will be set to the env variable UPSTASH_WORKFLOW_URL if not passed.
   * If the env variable is not set, the url will be infered as usual from
   * the `request.url` or the `url` parameter in `serve` options.
   *
   * @default undefined
   */
  baseUrl?: string;
  /**
   * Optionally, one can pass an env object mapping environment
   * variables to their keys.
   *
   * Useful in cases like cloudflare with hono.
   */
  env?: Record<string, string | undefined>;
  /**
   * Number of retries to use in workflow requests
   *
   * @default 3
   */
  retries?: number;
  /**
   * Whether the framework should use `content-type: application/json`
   * in `triggerFirstInvocation`.
   *
   * Not part of the public API. Only available in serveBase, which is not exported.
   */
  useJSONContent?: boolean;
  /**
   * By default, Workflow SDK sends telemetry about SDK version, framework or runtime.
   *
   * Set `disableTelemetry` to disable this behavior.
   * 
   * @default false
   */
  disableTelemetry?: boolean;
  /**
   * Settings for controlling the number of active requests
   * and number of requests per second with the same key.
   */
  flowControl?: FlowControl
} & ValidationOptions<TInitialPayload>;

type ValidationOptions<TInitialPayload> = {
  schema?: z.ZodType<TInitialPayload>;
  initialPayloadParser?: (initialPayload: string) => TInitialPayload;
};
export type ExclusiveValidationOptions<TInitialPayload> =
  | {
    schema?: ValidationOptions<TInitialPayload>["schema"];
    initialPayloadParser?: never;
  }
  | {
    schema?: never;
    initialPayloadParser?: ValidationOptions<TInitialPayload>["initialPayloadParser"];
  };

export type Telemetry = {
  /**
   * sdk version
   */
  sdk: string;
  /**
   * platform (such as nextjs/cloudflare)
   */
  framework: string;
  /**
   * node version
   */
  runtime?: string;
};

export type PublicServeOptions<
  TInitialPayload = unknown,
  TResponse extends Response = Response,
> = Omit<
  WorkflowServeOptions<TResponse, TInitialPayload>,
  "onStepFinish" | "useJSONContent" | "schema" | "initialPayloadParser"
> &
  ExclusiveValidationOptions<TInitialPayload>;

/**
 * Payload passed as body in failureFunction
 */
export type FailureFunctionPayload = {
  /**
   * error name
   */
  error: string;
  /**
   * error message
   */
  message: string;
};

/**
 * Makes all fields except the ones selected required
 */
export type RequiredExceptFields<T, K extends keyof T> = Omit<Required<T>, K> & Partial<Pick<T, K>>;

export type Waiter = {
  url: string;
  deadline: number;
  headers: Record<string, string[]>;
  timeoutUrl?: string;
  timeoutBody?: unknown;
  timeoutHeaders?: Record<string, string[]>;
};

export type NotifyResponse = {
  waiter: Waiter;
  messageId: string;
  error: string;
};

export type WaitRequest = {
  url: string;
  step: Step;
  timeout: string;
  timeoutUrl?: string;
  timeoutBody?: string;
  timeoutHeaders?: Record<string, string[]>;
};

export type WaitStepResponse = {
  /**
   * whether the wait for event step timed out. false if
   * the step is notified
   */
  timeout: boolean;
  /**
   * body passed in notify request
   */
  eventData: unknown;
};

export type NotifyStepResponse = {
  /**
   * notified event id
   */
  eventId: string;
  /**
   * event data sent with notify
   */
  eventData: unknown;
  /**
   * response from notify
   */
  notifyResponse: NotifyResponse[];
};

export type CallResponse<TResult = unknown> = {
  status: number;
  body: TResult;
  header: Record<string, string[]>;
};

/**
 * Valid duration string formats
 * @example "30s" // 30 seconds
 * @example "5m"  // 5 minutes
 * @example "2h"  // 2 hours
 * @example "1d"  // 1 day
 */
export type Duration = `${bigint}${"s" | "m" | "h" | "d"}`;

export interface WaitEventOptions {
  /**
   * Duration in seconds to wait for an event before timing out the workflow.
   * @example 300 // 5 minutes in seconds
   * @example "5m" // 5 minutes as duration string
   * @default "7d"
   */
  timeout?: number | Duration;
}

export type CallSettings<TBody = unknown> = {
  url: string;
  method?: HTTPMethods;
  body?: TBody;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: Duration | number;
  flowControl?: FlowControl;
};

export type HeaderParams = {
  /**
   * whether the request is a first invocation request.
   */
  initHeaderValue: "true" | "false";
  /**
   * run id of the workflow
   */
  workflowRunId: string;
  /**
   * url where the workflow is hosted
   */
  workflowUrl: string;
  /**
   * user headers which will be forwarded in the request
   */
  userHeaders?: Headers;
  /**
   * failure url to call incase of failure
   */
  failureUrl?: WorkflowServeOptions["failureUrl"];
  /**
   * retry setting of requests except context.call
   */
  retries?: number;
  /**
   * telemetry to include in timeoutHeaders.
   *
   * Only needed/used when the step is a waitForEvent step
   */
  telemetry?: Telemetry;
  /**
   * invoke count to include in headers
   */
  invokeCount?: number;
  /**
   * Settings for controlling the number of active requests
   * and number of requests per second with the same key.
   */
  flowControl?: FlowControl;
} & (
    | {
      /**
       * step to generate headers for
       */
      step: Step;
      /**
       * number of retries in context.call
       */
      callRetries?: number;
      /**
       * timeout duration in context.call
       */
      callTimeout?: number | Duration;
      /**
       * Settings for controlling the number of active requests
       * and number of requests per second with the same key.
       * 
       * will be passed in context.call.
       */
      callFlowControl?: FlowControl;
    }
    | {
      /**
       * step not passed. Either first invocation or simply getting headers for
       * third party callack.
       */
      step?: never;
      /**
       * number of retries in context.call
       *
       * set to never because this is not a context.call step
       */
      callRetries?: never;
      /**
       * timeout duration in context.call
       *
       * set to never because this is not a context.call step
       */
      callTimeout?: never;
      /**
       * Settings for controlling the number of active requests
       * and number of requests per second with the same key.
       * 
       * will be passed in context.call.
       */
      callFlowControl?: never;
    }
  );

export type InvokeWorkflowRequest = {
  workflowUrl: string;
  workflowRunId: string;
  headers: Record<string, string[]>;
  step: Step;
  body: string;
};

export type LazyInvokeStepParams<TInitiaPayload, TResult> = {
  workflow: Pick<
    InvokableWorkflow<TInitiaPayload, TResult>,
    "routeFunction" | "workflowId" | "options"
  >;
  body: TInitiaPayload; // TODO make optional
  workflowRunId?: string;
} & Pick<CallSettings, "retries" | "headers">;

export type InvokeStepResponse<TBody> = {
  body: TBody;
  isCanceled?: boolean;
  isFailed?: boolean;
};

export type InvokableWorkflow<TInitialPayload, TResult> = {
  routeFunction: RouteFunction<TInitialPayload, TResult>;
  options: WorkflowServeOptions<Response, TInitialPayload>;
  workflowId?: string;
};
