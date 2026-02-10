import { FlowControl, HTTPMethods, PublishRequest } from "@upstash/qstash";
import { RawStep, StepType } from "../types";

type BaseStepLog = {
  /**
   * id of the step
   */
  stepId?: number;
  /**
   * name of the step
   */
  stepName: string;
  /**
   * type of the step (example: "call", "wait", "invoke")
   */
  stepType: StepType;
  /**
   * call type of the step.
   *
   * in most cases it's `step`. For context.call, it will become `toCallback` and `fromCallback`
   * as the step executes.
   */
  callType: RawStep["callType"];
  /**
   * message id of the step
   */
  messageId: string;
  /**
   * result of the step
   *
   * will be undefined for an unfinished parallel step.
   */
  out: unknown;
  /**
   * number of retries for the step
   */
  retries: number;
  /**
   * retry delay parameter for the step if it was set
   */
  retryDelay?: string;
  /**
   * number of parallel steps
   *
   * if the step is sequential (non-parallel), will be 1.
   */
  concurrent: number;
  /**
   * state of the step
   */
  state: "STEP_PROGRESS" | "STEP_SUCCESS" | "STEP_RETRY" | "STEP_FAILED";
  /**
   * time when the step was created
   */
  createdAt: number;
  /**
   * headers
   */
  headers: Record<string, string[]>;
};

type CallUrlGroup = {
  /**
   * URL called in context.call
   */
  callUrl: string;
  /**
   * Method used in context.call
   */
  callMethod: HTTPMethods;
  /**
   * headers sent in context.call
   */
  callHeaders: Record<string, string[]>;
  /**
   * Body sent in context.call
   */
  callBody: unknown;
};

type CallResponseStatusGroup = {
  /**
   * Status code of the context.call response
   */
  callResponseStatus: number;
  /**
   * Response body of the context.call response
   */
  callResponseBody: unknown;
  /**
   * Headers received from the context.call response
   */
  callResponseHeaders: Record<string, string[]>;
} & CallUrlGroup;

type InvokedWorkflowGroup = {
  /**
   * id of the workflow run invoked in context.invoke
   */
  invokedWorkflowRunId: string;
  /**
   * URL of the workflow invoked in context.invoke
   */
  invokedWorkflowUrl: string;
  /**
   * Time when the workflow was invoked
   */
  invokedWorkflowCreatedAt: number;
  /**
   * Body sent in context.invoke
   */
  invokedWorkflowRunBody: unknown;
  /**
   * Headers sent in context.invoke
   */
  invokedWorkflowRunHeaders: Record<string, string[]>;
};

type WaitEventGroup = {
  /**
   * id of the event waited in context.waitForEvent
   */
  waitEventId: string;
  /**
   * Duration until the time when the event will be triggered due to timeout
   */
  waitTimeoutDuration: string;
  /**
   * Time when the event will be triggered due to timeout
   */
  waitTimeoutDeadline: number;
  /**
   * Whether the event was triggered due to timeout
   */
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
  /**
   * error message associated with the request
   *
   * example:
   * ```
   * detected a non-workflow destination for trigger/invoke.
   * make sure you are sending the request to the correct endpoint
   * ```
   */
  error: string;
  /**
   * response body returned in the request which resulted in an error
   */
  body: string;
  headers: Record<string, string[]>;
  status: number;
  time: number;
};

type StepLogGroup =
  | {
    /**
     * Log which belongs to a single step
     */
    steps: [StepLog];
    /**
     * Log which belongs to a single step
     */
    type: "sequential";
  }
  | {
    /**
     * Log which belongs to parallel steps
     */
    steps: StepLog[];
    /**
     * Log which belongs to parallel steps
     */
    type: "parallel";
  }
  | {
    /**
     * Log which belongs to the next step
     */
    steps: {
      messageId: string;
      state: "STEP_PROGRESS" | "STEP_RETRY" | "STEP_FAILED" | "STEP_CANCELED";
      /**
       * retries
       */
      retries: number;
      /**
       * retry delay parameter for the step if it was set
       */
      retryDelay?: string;
      /**
       * errors which occured in the step
       */
      errors?: StepError[];
    }[];
    /**
     * Log which belongs to the next step
     */
    type: "next";
  };

type FailureFunctionLog = {
  /**
   * messageId of the message published for handling the failure
   */
  messageId: string;
  /**
   * URL of the function that handles the failure
   */
  url: string;
  /**
   * State of the message published for failure
   */
  state: "CALLBACK_INPROGRESS" | "CALLBACK_SUCCESS" | "CALLBACK_FAIL";
  /**
   * Headers received from the step which caused the workflow to fail
   */
  failHeaders: Record<string, string[]>;
  /**
   * Status code of the step which caused the workflow to fail
   */
  failStatus: number;
  /**
   * Response body of the step which caused the workflow to fail
   */
  failResponse: string;
  /**
   * @deprecated use dlqId field of the workflow run itself
   */
  dlqId: string;
  /**
   * Errors received while running failure function
   */
  errors?: StepError[];
  /**
   * String body returned from the failure function
   */
  responseBody?: string;
  /**
   * Headers received from the failure function
   */
  responseHeaders?: Record<string, string[]>;
  /**
   * Status code of the response from the failure function
   */
  responseStatus?: number;
};

export type WorkflowRunLog = {
  /**
   * Unique identifier for the workflow run
   */
  workflowRunId: string;
  /**
   * URL of the workflow that was run
   */
  workflowUrl: string;
  /**
   * State of the workflow run
   *
   * - RUN_STARTED: Workflow run has started and is in progress
   * - RUN_SUCCESS: Workflow run has completed successfully
   * - RUN_FAILED: Workflow run has failed
   */
  workflowState: "RUN_STARTED" | "RUN_SUCCESS" | "RUN_FAILED" | "RUN_CANCELED";
  /**
   * Time when the workflow run was created
   *
   * in unix milliseconds format
   */
  workflowRunCreatedAt: number;
  /**
   * Time when the workflow run was completed
   *
   * in unix milliseconds format
   */
  workflowRunCompletedAt?: number;
  /**
   * Message published when the workflow fails if failureUrl or failureFunction
   * are set.
   */
  failureFunction?: FailureFunctionLog;
  /**
   *
   */
  steps: StepLogGroup[];
  /**
   * If the workflow returned a response, the stringified state of this
   * response will be available in the workflowRunResponse field.
   *
   * To restore it to its original format, use JSON.parse.
   */
  workflowRunResponse?: string;
  /**
   * Information on the invoker workflow run, if any
   */
  invoker?: {
    /**
     * run id of the invoker workflow
     */
    workflowRunId: string;
    /**
     * URL of the invoker workflow
     */
    workflowUrl: string;
    /**
     * Time when the invoker workflow run was created
     *
     * in unix milliseconds format
     */
    workflowRunCreatedAt: number;
  };
  /**
   * If the workflow run has failed, id of the run in DLQ
   */
  dlqId?: string;
  /**
   * Label of the workflow run
   */
  label?: string;
};

export type WorkflowRunLogs = {
  cursor: string;
  runs: WorkflowRunLog[];
};

export type TriggerOptions = {
  /**
   * URL of the workflow to trigger
   */
  url: string;
  /**
   * Body to send to the workflow
   */
  body?: unknown;
  /**
   * Headers to send to the workflow
   */
  headers?: Record<string, string>;
  /**
   * Workflow run id to use for the workflow run.
   * If not provided, a random workflow run id will be generated.
   */
  workflowRunId?: string;
  /**
   * Number of retries to perform if the request fails.
   *
   * @default 3
   */
  retries?: number;
  /**
   * Delay between retries.
   *
   * By default, the `retryDelay` is exponential backoff.
   * More details can be found in: https://upstash.com/docs/qstash/features/retry.
   *
   * The `retryDelay` option allows you to customize the delay (in milliseconds) between retry attempts when message delivery fails.
   *
   * You can use mathematical expressions and the following built-in functions to calculate the delay dynamically.
   * The special variable `retried` represents the current retry attempt count (starting from 0).
   *
   * Supported functions:
   * - `pow`
   * - `sqrt`
   * - `abs`
   * - `exp`
   * - `floor`
   * - `ceil`
   * - `round`
   * - `min`
   * - `max`
   *
   * Examples of valid `retryDelay` values:
   * ```ts
   * 1000 // 1 second
   * 1000 * (1 + retried)  // 1 second multiplied by the current retry attempt
   * pow(2, retried) // 2 to the power of the current retry attempt
   * max(10, pow(2, retried)) // The greater of 10 or 2^retried
   * ```
   */
  retryDelay?: string;

  /**
   * Flow control to use for the workflow run.
   * If not provided, no flow control will be used.
   */
  flowControl?: FlowControl;
  /**
   * Delay to apply before triggering the workflow.
   */
  delay?: PublishRequest["delay"];
  /**
   * Optionally set the absolute delay of this message.
   * This will override the delay option.
   * The message will not delivered until the specified time.
   *
   * Unix timestamp in seconds.
   *
   * @default undefined
   */
  notBefore?: PublishRequest["notBefore"];
  /**
   * Label to apply to the workflow run.
   *
   * Can be used to filter the workflow run logs.
   */
  label?: string;
  /**
   * By default, Workflow SDK sends telemetry about SDK version, framework or runtime.
   *
   * Set `disableTelemetry` to disable this behavior.
   *
   * @default false
   */
  disableTelemetry?: boolean;
  /**
   * URL to call if the first request to the workflow endpoint fails
   */
  failureUrl?: string;
};

export type DLQResumeRestartOptions<TDLQId extends string | string[] = string | string[]> = {
  dlqId: TDLQId;
} & Pick<TriggerOptions, "flowControl" | "retries">;

export type DLQResumeRestartResponse = {
  /**
   * id of the workflow run created to resume or restart the DLQ message
   */
  workflowRunId: string;
  /**
   * Time when the new workflow run was created
   */
  workflowCreatedAt: string;
};

export type WorkflowBulkFilters = {
  workflowRunId?: string;
  workflowUrl?: string;
  fromDate?: string;
  toDate?: string;
  label?: string;
};
