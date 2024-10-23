import { QstashError } from "@upstash/qstash";
import type { FailureFunctionPayload, Step } from "./types";

/**
 * Error raised during Workflow execution
 */
export class QStashWorkflowError extends QstashError {
  constructor(message: string) {
    super(message);
    this.name = "QStashWorkflowError";
  }
}

/**
 * Raised when the workflow executes a function successfully
 * and aborts to end the execution
 */
export class QStashWorkflowAbort extends Error {
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
    this.name = "QStashWorkflowAbort";
    this.stepName = stepName;
    this.stepInfo = stepInfo;
    this.cancelWorkflow = cancelWorkflow;
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
      }
    : {
        error: "Error",
        message: "An error occured while executing workflow.",
      };
};
