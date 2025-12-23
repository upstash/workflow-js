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
 * Raised when the workflow executes a function successfully
 * and aborts to end the execution
 */
export class WorkflowAbort extends Error {
  public stepInfo?: Step;
  public stepName: string;
  /**
   * whether workflow is to be canceled on abort
   */
  public cancelWorkflow: boolean;

  /**
   *
   * @param stepName name of the aborting step
   * @param stepInfo step information
   * @param cancelWorkflow
   */
  constructor(stepName: string, stepInfo?: Step, cancelWorkflow = false) {
    super(
      "This is an Upstash Workflow error thrown after a step executes. It is expected to be raised." +
        " Make sure that you await for each step. Also, if you are using try/catch blocks, you should not wrap context.run/sleep/sleepUntil/call methods with try/catch." +
        ` Aborting workflow after executing step '${stepName}'.`
    );
    this.name = "WorkflowAbort";
    this.stepName = stepName;
    this.stepInfo = stepInfo;
    this.cancelWorkflow = cancelWorkflow;
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
    super("fail", undefined, false);
    this.name = "WorkflowNonRetryableError";
    if (message) this.message = message;
  }
}

export class WorkflowRetryAfterError extends WorkflowAbort {
  public retryAfter: number | Duration;
  /**
   * @param retryAfter time in seconds after which the workflow should be retried
   * @param message error message to be displayed
   */
  constructor(message: string, retryAfter: number | Duration) {
    super("retry", undefined, false);
    this.name = "WorkflowRetryAfterError";
    this.retryAfter = retryAfter;
    if (message) this.message = message;
  }
}

/**
 * Formats an unknown error to match the FailureFunctionPayload format
 *
 * @param error error to format
 * @returns formatted error payload
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

/**
 * Gets the constructor name of an object.
 *
 * @param obj object to get constructor name from
 * @returns constructor name or null
 */
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

/**
 * Gets all constructor names in the prototype chain.
 *
 * @param obj object to get constructor names from
 * @returns array of constructor names
 */
function getConstructorNames(obj: unknown): string[] {
  const proto = Object.getPrototypeOf(obj);
  const name = getConstructorName(proto);
  if (name === null) {
    return [];
  }
  return [name, ...getConstructorNames(proto)];
}

/**
 * Checks if a value is an instance of a specific class.
 *
 * @param v value to check
 * @param c class constructor to check against
 * @returns true if v is an instance of c
 */
export function isInstanceOf<T>(
  v: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctor: new (...args: any[]) => T
): v is T {
  return getConstructorNames(v).includes(ctor.name);
}
