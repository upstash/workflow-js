import { WorkflowError } from "../error";
import { MiddlewareCallbacks, MiddlewareInitCallbacks, MiddlewareParameters } from "../types";

export const onErrorWithConsole: Required<MiddlewareCallbacks>["onError"] = async ({
  workflowRunId,
  error,
}) => {
  console.error(`  [Upstash Workflow]: Error in workflow run ${workflowRunId}: ` + error);
};

export const onWarningWithConsole: Required<MiddlewareCallbacks>["onWarning"] = async ({
  workflowRunId,
  warning,
}) => {
  console.warn(`  [Upstash Workflow]: Warning in workflow run ${workflowRunId}: ` + warning);
};

export const onInfoWithConsole: Required<MiddlewareCallbacks>["onInfo"] = async ({
  workflowRunId,
  info,
}) => {
  console.info(`  [Upstash Workflow]: Info in workflow run ${workflowRunId}: ` + info);
};

export class WorkflowMiddleware {
  public readonly name: string;
  private initCallbacks?: MiddlewareInitCallbacks;
  /**
   * Callback functions
   *
   * Initially set to undefined, will be populated after init is called
   */
  private middlewareCallbacks?: MiddlewareCallbacks = undefined;

  constructor(parameters: MiddlewareParameters) {
    this.name = parameters.name;

    if ("init" in parameters) {
      this.initCallbacks = parameters.init;
    } else {
      this.middlewareCallbacks = parameters.callbacks;
    }
  }

  async runCallback<K extends keyof MiddlewareCallbacks>(
    callback: K,
    parameters: Parameters<NonNullable<MiddlewareCallbacks[K]>>[0]
  ): Promise<boolean> {
    await this.ensureInit(parameters.workflowRunId);
    const cb = this.middlewareCallbacks?.[callback];
    if (cb) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await cb(parameters as any);
      } catch (error) {
        try {
          const onErrorCallback = this.middlewareCallbacks?.onError ?? onErrorWithConsole;
          await onErrorCallback({ workflowRunId: parameters.workflowRunId, error: error as Error });
        } catch (onErrorError) {
          console.error(
            `Failed while executing "onError" of middleware "${this.name}", falling back to logging the error to console. Error: ${onErrorError}`
          );
          onErrorWithConsole({ workflowRunId: parameters.workflowRunId, error: error as Error });
        }
      }
      return true;
    }
    return false;
  }

  private async ensureInit(workflowRunId: string) {
    if (!this.middlewareCallbacks) {
      if (!this.initCallbacks) {
        throw new WorkflowError(`Middleware "${this.name}" has no callbacks or init defined.`);
      }
      this.middlewareCallbacks = await this.initCallbacks({ workflowRunId });
    }
  }
}

export const runMiddlewares = async <K extends keyof MiddlewareCallbacks>(
  middlewares: WorkflowMiddleware[] | undefined,
  callback: K,
  parameters: Parameters<NonNullable<MiddlewareCallbacks[K]>>[0]
) => {
  let executedCount = 0;

  if (middlewares && middlewares.length > 0) {
    const middlewareExecuted = await Promise.all(
      middlewares.map(async (m) => {
        return await m.runCallback(callback, parameters);
      })
    );
    executedCount = middlewareExecuted.filter((executed) => executed).length;
  }

  // if no middleware handled the onError or onWarning, log to console as a fallback
  if (executedCount === 0) {
    if (callback === "onError") {
      onErrorWithConsole(parameters as { workflowRunId: string; error: Error });
    } else if (callback === "onWarning") {
      onWarningWithConsole(parameters as { workflowRunId: string; warning: string });
    }
  }
};
