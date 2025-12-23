import { WorkflowError } from "../error";
import { MiddlewareCallbacks, MiddlewareInitCallbacks, MiddlewareParameters } from "./types";

export class WorkflowMiddleware<TInitialPayload = unknown, TResult = unknown> {
  public readonly name: string;
  private initCallbacks?: MiddlewareInitCallbacks<TInitialPayload, TResult>;
  /**
   * Callback functions
   *
   * Initially set to undefined, will be populated after init is called
   */
  private middlewareCallbacks?: MiddlewareCallbacks<TInitialPayload, TResult> = undefined;

  constructor(parameters: MiddlewareParameters<TInitialPayload, TResult>) {
    this.name = parameters.name;

    if ("init" in parameters) {
      this.initCallbacks = parameters.init;
    } else {
      this.middlewareCallbacks = parameters.callbacks;
    }
  }

  async ensureInit() {
    if (!this.middlewareCallbacks) {
      if (!this.initCallbacks) {
        throw new WorkflowError(`Middleware "${this.name}" has no callbacks or init defined.`);
      }
      this.middlewareCallbacks = await this.initCallbacks();
    }
  }

  /**
   * Gets a callback function by name.
   *
   * @param callback name of the callback to retrieve
   */
  getCallback<K extends keyof MiddlewareCallbacks<TInitialPayload, TResult>>(
    callback: K
  ): MiddlewareCallbacks<TInitialPayload, TResult>[K] | undefined {
    return this.middlewareCallbacks?.[callback];
  }
}
