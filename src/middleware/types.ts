import { WorkflowContext } from "../context";

export type LifeCycleEvent = "beforeExecution" | "afterExecution" | "runStarted" | "runCompleted";
export type DebugEvent = "onError" | "onWarning" | "onInfo";

export type LifeCycleEventParameters<TResult> = {
  beforeExecution: {
    stepName: string;
  };
  afterExecution: {
    stepName: string;
    result: unknown;
  };
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  runStarted: {};
  runCompleted: {
    result: TResult;
  };
};

export type DebugEventParameters = {
  onError: { error: Error };
  onWarning: { warning: string };
  onInfo: { info: string };
};

export type MiddlewareCallbacks<TInitialPayload, TResult> = Partial<
  {
    [K in LifeCycleEvent]: (
      params: LifeCycleEventParameters<TResult>[K] & {
        context: WorkflowContext<TInitialPayload>;
      }
    ) => Promise<void> | void;
  } & {
    [K in DebugEvent]: (
      params: DebugEventParameters[K] & { workflowRunId?: string }
    ) => Promise<void> | void;
  }
>;

export type MiddlewareInitCallbacks<TInitialPayload, TResult> = () =>
  | Promise<MiddlewareCallbacks<TInitialPayload, TResult>>
  | MiddlewareCallbacks<TInitialPayload, TResult>;

export type MiddlewareCallbackConfig<TInitialPayload, TResult> =
  | {
      init: MiddlewareInitCallbacks<TInitialPayload, TResult>;
    }
  | {
      callbacks: MiddlewareCallbacks<TInitialPayload, TResult>;
    };

export type MiddlewareParameters<TInitialPayload, TResult> = {
  name: string;
} & MiddlewareCallbackConfig<TInitialPayload, TResult>;

/**
 * Type for the dispatch debug method that can be passed to helper functions
 * without needing to pass generics everywhere
 */
export type DispatchDebug = <K extends DebugEvent>(
  event: K,
  params: DebugEventParameters[K]
) => Promise<void>;

/**
 * Type for the dispatch lifecycle method
 */
export type DispatchLifecycle<TResult = unknown> = <K extends LifeCycleEvent>(
  event: K,
  params: LifeCycleEventParameters<TResult>[K]
) => Promise<void>;
