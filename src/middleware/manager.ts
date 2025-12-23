import { WorkflowContext } from "../context";
import { WorkflowError } from "../error";
import { onErrorWithConsole, onWarningWithConsole } from "./default-callbacks";
import { WorkflowMiddleware } from "./middleware";
import {
  DebugEvent,
  DebugEventParameters,
  LifeCycleEvent,
  LifeCycleEventParameters,
} from "./types";

/**
 * MiddlewareManager - Simplified middleware dispatcher
 *
 * This class manages middleware execution without requiring generics everywhere.
 * Once created, you can export dispatch methods that handle both lifecycle and debug events.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MiddlewareManager<TInitialPayload = any, TResult = any> {
  private middlewares: WorkflowMiddleware<TInitialPayload, TResult>[];
  private workflowRunId: string | undefined;
  private context: WorkflowContext<TInitialPayload> | undefined;

  /**
   * @param middlewares list of workflow middlewares
   */
  constructor(middlewares: WorkflowMiddleware<TInitialPayload, TResult>[] = []) {
    this.middlewares = middlewares;
  }

  /**
   * Assign workflow run ID - will be passed to debug events
   *
   * @param workflowRunId workflow run id to assign
   */
  assignWorkflowRunId(workflowRunId: string) {
    this.workflowRunId = workflowRunId;
  }

  /**
   * Assign context - required for lifecycle events
   *
   * also assigns workflowRunId from context
   *
   * @param context workflow context to assign
   */
  assignContext(context: WorkflowContext<TInitialPayload>) {
    this.context = context;
    this.workflowRunId = context.workflowRunId;
  }

  /**
   * Internal method to execute middlewares with common error handling logic
   *
   * @param event event name to dispatch
   * @param params event parameters
   */
  private async executeMiddlewares<K extends DebugEvent | LifeCycleEvent>(
    event: K,
    params: unknown
  ): Promise<void> {
    // Initialize all middlewares first
    await Promise.all(this.middlewares.map((m) => m.ensureInit()));

    // Execute callbacks
    await Promise.all(
      this.middlewares.map(async (middleware) => {
        const callback = middleware.getCallback(event);
        if (callback) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await callback(params as any);
          } catch (error) {
            try {
              const onErrorCallback = middleware.getCallback("onError") ?? onErrorWithConsole;
              await onErrorCallback({
                workflowRunId: this.workflowRunId,
                error: error as Error,
              });
            } catch (onErrorError) {
              console.error(
                `Failed while executing "onError" of middleware "${middleware.name}", falling back to logging the error to console. Error: ${onErrorError}`
              );
              onErrorWithConsole({
                workflowRunId: this.workflowRunId,
                error: error as Error,
              });
            }
          }
        }
      })
    );

    if (event === "onError") {
      onErrorWithConsole({
        workflowRunId: this.workflowRunId,
        ...(params as DebugEventParameters["onError"]),
      });
    } else if (event === "onWarning") {
      onWarningWithConsole({
        workflowRunId: this.workflowRunId,
        ...(params as DebugEventParameters["onWarning"]),
      });
    }
  }

  /**
   * Dispatch a debug event (onError, onWarning, onInfo)
   *
   * @param event debug event name
   * @param params event parameters
   */
  async dispatchDebug<K extends DebugEvent>(
    event: K,
    params: DebugEventParameters[K]
  ): Promise<void> {
    const paramsWithRunId = {
      ...params,
      workflowRunId: this.workflowRunId,
    };

    await this.executeMiddlewares(event, paramsWithRunId);
  }

  /**
   * Dispatch a lifecycle event (beforeExecution, afterExecution, runStarted, runCompleted)
   *
   * @param event lifecycle event name
   * @param params event parameters
   */
  async dispatchLifecycle<K extends LifeCycleEvent>(
    event: K,
    params: LifeCycleEventParameters<TResult>[K]
  ): Promise<void> {
    if (!this.context) {
      throw new WorkflowError(
        `Something went wrong while calling middlewares. Lifecycle event "${event}" was called before assignContext.`
      );
    }

    const paramsWithContext = {
      ...params,
      context: this.context,
    };

    await this.executeMiddlewares(event, paramsWithContext);
  }
}
