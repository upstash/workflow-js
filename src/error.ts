import { QstashError } from "@upstash/qstash";
import type { Duration, FailureFunctionPayload, Step } from "./types";

/**
 * Error raised during Workflow execution
 */
export class WorkflowError extends QstashError {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

/**
 * Base error for workflow abort scenarios
 * Raised when a workflow step executes successfully.
 */
export class WorkflowAbort extends Error {
  public stepName: string;
  public stepInfo?: Step;

  /**
   * @param stepName name of the aborting step
   * @param stepInfo step information
   */
  constructor(stepName: string, stepInfo?: Step) {
    super(
      "This is an Upstash Workflow error thrown after a step executes. It is expected to be raised." +
        " Make sure that you await for each step. Also, if you are using try/catch blocks, you should not wrap context.run/sleep/sleepUntil/call methods with try/catch." +
        ` Aborting workflow after executing step '${stepName}'.`
    );
    this.name = "WorkflowAbort";
    this.stepName = stepName;
    this.stepInfo = stepInfo;
  }
}

/**
 * Raised during authorization/dry-run to indicate a step was found
 */
export class WorkflowAuthError extends WorkflowAbort {
  /**
   * @param stepName name of the step found during authorization
   */
  constructor(stepName: string) {
    super(stepName);
    this.name = "WorkflowAuthError";
    this.message =
      "This is an Upstash Workflow error thrown during authorization check." +
      ` Found step '${stepName}' during dry-run.`;
  }
}

/**
 * Raised when user explicitly cancels the workflow via context.cancel()
 */
export class WorkflowCancelAbort extends WorkflowAbort {
  constructor() {
    super("cancel");
    this.name = "WorkflowCancelAbort";
    this.message = "Workflow has been canceled by user via context.cancel().";
  }
}

/**
 * Raised when the workflow is failed due to a non-retryable error
 */
export class WorkflowNonRetryableError extends WorkflowAbort {
  /**
   * @param message error message to be displayed
   */
  constructor(message?: string) {
    super("non-retryable-error");
    this.name = "WorkflowNonRetryableError";
    this.message = message ?? "Workflow failed with non-retryable error.";
  }
}

export class WorkflowRetryAfterError extends WorkflowAbort {
  public retryAfter: number | Duration;
  /**
   * @param message error message to be displayed
   * @param retryAfter time in seconds after which the workflow should be retried
   */
  constructor(message: string, retryAfter: number | Duration) {
    super("retry-after-error");
    this.name = "WorkflowRetryAfterError";
    this.message = message;
    this.retryAfter = retryAfter;
  }
}

/**
 * Formats an unknown error to match the FailureFunctionPayload format
 *
 * @param error
 * @returns
 */
export const formatWorkflowError = (error: unknown): FailureFunctionPayload => {
  return error instanceof Error
    ? {
        error: error.name,
        message: error.message,
        stack: error.stack,
      }
    : {
        error: "Error",
        message:
          "An error occured while executing workflow: " +
          `'${typeof error === "string" ? error : JSON.stringify(error)}'`,
      };
};

function getConstructorName(obj: unknown): string | null {
  if (obj === null || obj === undefined) {
    return null;
  }
  const ctor = obj.constructor;
  if (!ctor || ctor.name === "Object") {
    return null;
  }
  return ctor.name;
}

function getConstructorNames(obj: unknown): string[] {
  const proto = Object.getPrototypeOf(obj);
  const name = getConstructorName(proto);
  if (name === null) {
    return [];
  }
  return [name, ...getConstructorNames(proto)];
}

export function isInstanceOf<T>(
  v: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctor: new (...args: any[]) => T
): v is T {
  return getConstructorNames(v).includes(ctor.name);
}
