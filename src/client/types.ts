import { HTTPMethods, State } from "@upstash/qstash";
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
  AsOptional<WaitEventGroup>;

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
      steps: { messageId: string; state: "STEP_PROGRESS" | "STEP_RETRY" | "STEP_FAILED" }[];
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
  state: State;
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
  dlqId: string;
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
};

export type WorkflowRunLogs = {
  cursor: string;
  runs: WorkflowRunLog[];
};
