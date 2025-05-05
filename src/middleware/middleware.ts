import { MiddlewareCallbacks, MiddlewareParameters } from "../types";

export class WorkflowMiddleware {
  private readonly init: MiddlewareParameters["init"];
  private middlewareCallbacks?: MiddlewareCallbacks;

  constructor(parameters: MiddlewareParameters) {
    this.init = parameters.init;
    this.middlewareCallbacks = undefined;
  }

  async runCallback<K extends keyof MiddlewareCallbacks>(
    callback: K,
    parameters: Parameters<NonNullable<MiddlewareCallbacks[K]>>[0]
  ): Promise<void> {
    await this.ensureInit(parameters.workflowRunId);
    const cb = this.middlewareCallbacks?.[callback];
    if (cb) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await cb(parameters as any);
    }
  }

  private async ensureInit(workflowRunId: string) {
    if (!this.middlewareCallbacks) {
      this.middlewareCallbacks = await this.init({ workflowRunId });
    }
  }
}

export const runMiddlewares = async <K extends keyof MiddlewareCallbacks>(
  middlewares: WorkflowMiddleware[] | undefined,
  callback: K,
  parameters: Parameters<NonNullable<MiddlewareCallbacks[K]>>[0]
) => {
  if (!middlewares) {
    return;
  }

  middlewares.forEach(async (m) => {
    await m.runCallback(callback, parameters);
  });
};
