import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import {
  isInstanceOf,
  WorkflowAbort,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from "../error";
import { RouteFunction } from "../types";
import { WorkflowContext } from "../context";
import { BaseLazyStep } from "../context/steps";
import { Client } from "@upstash/qstash";

/**
 * Workflow context which throws WorkflowAbort before running the steps.
 *
 * Used for making a dry run before running any steps to check authentication.
 *
 * Consider an endpoint like this:
 * ```ts
 * export const POST = serve({
 *   routeFunction: context => {
 *     if (context.headers.get("authentication") !== "Bearer secretPassword") {
 *       console.error("Authentication failed.");
 *       return;
 *     }
 *
 *     // ...
 *   }
 * })
 * ```
 *
 * the serve method will first call the routeFunction with an DisabledWorkflowContext.
 * Here is the action we take in different cases
 * - "step-found": we will run the workflow related sections of `serve`.
 * - "run-ended": simply return success and end the workflow
 * - error: returns 500.
 */
export class DisabledWorkflowContext<
  TInitialPayload = unknown,
> extends WorkflowContext<TInitialPayload> {
  private static readonly disabledMessage = "disabled-qstash-worklfow-run";
  public readonly disabled = true;

  /**
   * overwrite the WorkflowContext.addStep method to always raise WorkflowAbort
   * error in order to stop the execution whenever we encounter a step.
   *
   * @param _step
   */
  protected async addStep<TResult = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _step: BaseLazyStep<TResult>
  ): Promise<TResult> {
    throw new WorkflowAbort(DisabledWorkflowContext.disabledMessage);
  }

  /**
   * overwrite cancel method to throw WorkflowAbort with the disabledMessage
   */
  public async cancel() {
    throw new WorkflowAbort(DisabledWorkflowContext.disabledMessage);
  }

  /**
   * copies the passed context to create a DisabledWorkflowContext. Then, runs the
   * route function with the new context.
   *
   * - returns "run-ended" if there are no steps found or
   *      if the auth failed and user called `return`
   * - returns "step-found" if DisabledWorkflowContext.addStep is called.
   * - if there is another error, returns the error.
   *
   * @param routeFunction
   */
  public static async tryAuthentication<TInitialPayload = unknown>(
    routeFunction: RouteFunction<TInitialPayload>,
    context: WorkflowContext<TInitialPayload>
  ): Promise<Ok<"step-found" | "run-ended", never> | Err<never, Error>> {
    const disabledContext = new DisabledWorkflowContext({
      qstashClient: new Client({
        baseUrl: "disabled-client",
        token: "disabled-client",
      }),
      workflowRunId: context.workflowRunId,
      headers: context.headers,
      steps: [],
      url: context.url,
      failureUrl: context.failureUrl,
      initialPayload: context.requestPayload,
      env: context.env,
      retries: context.retries,
      retryDelay: context.retryDelay,
      flowControl: context.flowControl,
      label: context.label,
    });

    try {
      await routeFunction(disabledContext);
    } catch (error) {
      if (
        (isInstanceOf(error, WorkflowAbort) && error.stepName === this.disabledMessage) ||
        isInstanceOf(error, WorkflowNonRetryableError) ||
        isInstanceOf(error, WorkflowRetryAfterError)
      ) {
        return ok("step-found");
      }
      console.warn(
        "Upstash Workflow: Received an error while authorizing request. Please avoid throwing errors before the first step of your workflow."
      );
      return err(error as Error);
    }

    return ok("run-ended");
  }
}
