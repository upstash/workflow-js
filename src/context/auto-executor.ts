import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { attachStepNameToError, isInstanceOf, WorkflowAbort, WorkflowError } from "../error";
import type { WorkflowContext } from "./context";
import type { StepFunction, ParallelCallState, Step, StepSettings, Telemetry } from "../types";
import { type BaseLazyStep } from "./steps";
import { QstashError } from "@upstash/qstash";
import {
  executeStep,
  publishStepConfigRequest,
  submitParallelSteps,
  submitStepResult,
} from "../qstash/submit-steps";
import { describeStepSettingsMismatch, type EffectiveConfig } from "../qstash/step-config";
import { DispatchDebug, DispatchLifecycle } from "../middleware/types";
import { NO_CONCURRENCY } from "../constants";

/**
 * What came of submitting the step being held, if one was.
 */
export type PendingStepOutcome =
  | { result: "submitted-step"; abort: WorkflowAbort }
  | { result: "no-pending-step" };

/**
 * A step which executed but whose result QStash doesn't have yet: either
 * still held, or already on its way. Never both, and never neither while
 * a submission is outstanding.
 */
type PendingStep =
  | { status: "held"; lazyStep: BaseLazyStep; resultStep: Step }
  | { status: "submitting"; submitted: Promise<WorkflowAbort> };

export class AutoExecutor {
  private context: WorkflowContext;
  private promises = new WeakMap<BaseLazyStep[], Promise<unknown>>();
  private activeLazyStepList?: BaseLazyStep[];

  private readonly nonPlanStepCount: number;
  private readonly steps: Step[];
  private indexInCurrentList = 0;
  private readonly invokeCount: number;
  private readonly telemetry?: Telemetry;
  private readonly dispatchDebug: DispatchDebug;
  private readonly dispatchLifecycle: DispatchLifecycle;

  public stepCount = 0;
  public planStepCount = 0;

  protected executingStep: string | false = false;

  /**
   * an executed step whose result hasn't been submitted to QStash yet.
   *
   * Set when a step which can produce its result in-process executes. The
   * submission waits so that the route function can continue and reveal
   * what comes next: if that is a single step with step-level settings,
   * the settings ride on this submission and no step config request is
   * needed, since the delivery of the submission is what executes it.
   *
   * Flushed when the next step is reached (see `addStep`) or when the
   * route function ends (see `flushPendingStep` in `serve`).
   */
  private pendingStep?: PendingStep;
  /**
   * configuration QStash applied to the delivery being handled. A step
   * with step-level settings is gated by comparing its settings against
   * this.
   */
  private readonly effectiveConfig: EffectiveConfig;

  /**
   * @param context workflow context
   * @param steps list of steps
   * @param dispatchDebug debug event dispatcher
   * @param dispatchLifecycle lifecycle event dispatcher
   * @param telemetry optional telemetry information
   * @param invokeCount optional invoke count
   * @param effectiveConfig configuration QStash applied to the delivery
   *   being handled
   */
  constructor(
    context: WorkflowContext,
    steps: Step[],
    dispatchDebug: DispatchDebug,
    dispatchLifecycle: DispatchLifecycle,
    telemetry?: Telemetry,
    invokeCount?: number,
    effectiveConfig?: EffectiveConfig
  ) {
    this.context = context;
    this.steps = steps;
    this.dispatchDebug = dispatchDebug;
    this.dispatchLifecycle = dispatchLifecycle;
    this.telemetry = telemetry;
    this.invokeCount = invokeCount ?? 0;
    this.effectiveConfig = effectiveConfig ?? { hasStepConfig: false };

    this.nonPlanStepCount = this.steps.filter((step) => !step.targetStep).length;
  }

  /**
   * Adds the step function to the list of step functions to run in
   * parallel. After adding the function, defers the execution, so
   * that if there is another step function to be added, it's also
   * added.
   *
   * After all functions are added, list of functions are executed.
   * If there is a single function, it's executed by itself. If there
   * are multiple, they are run in parallel.
   *
   * If a function is already executing (this.executingStep), this
   * means that there is a nested step which is not allowed. In this
   * case, addStep throws WorkflowError.
   *
   * @param stepInfo step plan to add
   * @returns result of the step function
   */
  public async addStep<TResult>(stepInfo: BaseLazyStep<TResult>) {
    if (this.executingStep) {
      throw new WorkflowError(
        "A step can not be run inside another step." +
          ` Tried to run '${stepInfo.stepName}' inside '${this.executingStep}'`
      );
    }

    this.stepCount += 1;

    const lazyStepList = this.activeLazyStepList ?? [];

    if (!this.activeLazyStepList) {
      this.activeLazyStepList = lazyStepList;
      this.indexInCurrentList = 0;
    }

    lazyStepList.push(stepInfo);
    const index = this.indexInCurrentList++;

    const requestComplete = this.deferExecution().then(async () => {
      // A step executed in this invocation and its result is still
      // pending: this new step list is what comes next. Submit the
      // pending result and abort. When what comes next is a single step
      // with step-level settings, the settings ride on that submission,
      // so the delivery it produces is gated and executes the step. A
      // parallel group carries its settings on its own plan steps
      // instead, so nothing is attached for it.
      //
      // This runs before `getExecutionPromise`, so the new step's
      // function never executes here, and after the microtasks of
      // `deferExecution`, so a `withSettings` chained synchronously on
      // the returned promise has already applied.
      const submitted = await this.submitPendingStep(
        lazyStepList.length === 1 ? lazyStepList[0].stepSettings : undefined
      );
      if (submitted.isErr()) {
        throw submitted.error;
      }
      if (submitted.value.result === "submitted-step") {
        // the held step is on its way to QStash, so this invocation ends
        // here and the next step runs in the delivery it produces
        throw submitted.value.abort;
      }

      if (!this.promises.has(lazyStepList)) {
        const promise = this.getExecutionPromise(lazyStepList);
        this.promises.set(lazyStepList, promise);
        this.activeLazyStepList = undefined;

        // if there are more than 1 functions, increment the plan step count
        this.planStepCount += lazyStepList.length > 1 ? lazyStepList.length : 0;
      }
      const promise = this.promises.get(lazyStepList);
      return promise;
    });

    const result = await requestComplete;
    return AutoExecutor.getResult<TResult>(lazyStepList, result, index);
  }

  /**
   * Wraps a step function to set this.executingStep to step name
   * before running and set this.executingStep to False after execution
   * ends.
   *
   * this.executingStep allows us to detect nested steps which are not
   * allowed.
   *
   * @param stepName name of the step being wrapped
   * @param stepFunction step function to wrap
   * @returns wrapped step function
   */
  public wrapStep<TResult = unknown>(
    stepName: string,
    stepFunction: StepFunction<TResult>
  ): TResult | Promise<TResult> {
    this.executingStep = stepName;
    const result = stepFunction();
    this.executingStep = false;
    return result;
  }

  /**
   * Executes a step:
   * - If the step result is available in the steps, returns the result
   * - If the result is not available, runs the function
   * - Sends the result to QStash
   *
   * @param lazyStep lazy step to execute
   * @returns step result
   */
  protected async runSingle<TResult>(lazyStep: BaseLazyStep<TResult>): Promise<TResult> {
    if (this.stepCount < this.nonPlanStepCount) {
      const step = this.steps[this.stepCount + this.planStepCount];
      validateStep(lazyStep, step);
      const parsedOut = lazyStep.parseOut(step);

      const isLastMemoized =
        this.stepCount + 1 === this.nonPlanStepCount && this.steps.at(-1)!.stepId !== 0;

      if (isLastMemoized) {
        await this.dispatchLifecycle("afterExecution", {
          stepName: lazyStep.stepName,
          result: parsedOut,
        });
      }

      return parsedOut;
    }

    // A step's settings have to be on the message whose delivery executes
    // it, so before running it, compare what it asked for against the
    // configuration QStash applied to the delivery in hand.
    const mismatch = lazyStep.stepSettings
      ? describeStepSettingsMismatch(lazyStep.stepSettings, this.effectiveConfig)
      : undefined;

    if (mismatch && !this.effectiveConfig.hasStepConfig) {
      // This delivery was not published with step-level settings, so ask
      // for one that is. The step runs in the gated delivery that
      // request produces, not here.
      await publishStepConfigRequest({
        context: this.context,
        lazyStep,
        targetStep: this.stepCount,
        invokeCount: this.invokeCount,
        telemetry: this.telemetry,
        dispatchDebug: this.dispatchDebug,
      });
      throw new WorkflowAbort(lazyStep.stepName);
    }

    if (mismatch) {
      // The settings this SDK published came back in a form it does not
      // recognize, which is a bug in it. Run the step with the settings
      // of the delivery rather than publish a second step config
      // request: that would loop forever, and invisibly, since these
      // requests are hidden from the step logs.
      //
      // `dispatchDebug` writes warnings to the console itself, on top of
      // handing them to any user middleware.
      await this.dispatchDebug("onWarning", {
        warning:
          `The step-level settings of step '${lazyStep.stepName}' were published but are not` +
          ` recognized on the delivery which carries them (${mismatch}). Executing the step with` +
          ` the settings of the delivery instead. This is a bug in @upstash/workflow, please report it.`,
      });
    }

    const resultStep = await executeStep({
      lazyStep,
      stepId: this.stepCount,
      concurrency: NO_CONCURRENCY,
      dispatchLifecycle: this.dispatchLifecycle,
    });

    if (lazyStep.supportsDeferredSubmission) {
      // Hold the result instead of submitting it. Returning it lets the
      // route function continue and reveal what comes next, so that a
      // next step's settings can ride on this submission instead of
      // needing a step config request of their own.
      this.pendingStep = { status: "held", lazyStep, resultStep };

      // return the result after passing it through serialization, so that
      // the route function observes the exact same value here and in the
      // replays of the later invocations
      return lazyStep.parseOut({
        ...resultStep,
        out: resultStep.out === undefined ? undefined : JSON.stringify(resultStep.out),
      });
    }

    await submitStepResult({
      context: this.context,
      lazyStep,
      resultStep,
      invokeCount: this.invokeCount,
      concurrency: NO_CONCURRENCY,
      telemetry: this.telemetry,
      dispatchDebug: this.dispatchDebug,
    });
    throw new WorkflowAbort(lazyStep.stepName, resultStep);
  }

  /**
   * Submits the result of the step being held, if there is one, and
   * returns the abort the caller has to throw to end the invocation.
   *
   * Returns undefined when no step is being held, which is the caller's
   * signal that there is nothing to end. Throws instead of returning
   * when the submission itself fails, so that error reaches the caller
   * rather than an abort claiming the step was submitted.
   *
   * Callers which arrive while a submission is already under way (the
   * steps of a parallel group, added together) wait for that one and get
   * the same abort, rather than submitting a second time.
   *
   * The next step's settings are attached whenever it has any, without
   * checking them against the current delivery: the executor only knows
   * the configuration of the delivery in hand, which inside a gated
   * delivery is the *previous* step's, so such a check would be wrong
   * exactly when two gated steps follow each other.
   *
   * @param nextStepSettings step-level settings of the next step
   * @returns `submitted-step` with the abort which ends this invocation,
   *   or `no-pending-step` when nothing was held and there is nothing to
   *   end
   */
  public async submitPendingStep(
    nextStepSettings?: StepSettings
  ): Promise<Ok<PendingStepOutcome, never> | Err<never, Error>> {
    if (!this.pendingStep) {
      return ok({ result: "no-pending-step" });
    }

    try {
      if (this.pendingStep.status === "submitting") {
        return ok({ result: "submitted-step", abort: await this.pendingStep.submitted });
      }

      const { lazyStep, resultStep } = this.pendingStep;
      const submitted = (async () => {
        await submitStepResult({
          context: this.context,
          lazyStep,
          resultStep,
          invokeCount: this.invokeCount,
          concurrency: NO_CONCURRENCY,
          telemetry: this.telemetry,
          dispatchDebug: this.dispatchDebug,
          nextStepSettings,
        });
        return new WorkflowAbort(lazyStep.stepName, resultStep);
      })();
      this.pendingStep = { status: "submitting", submitted };

      return ok({ result: "submitted-step", abort: await submitted });
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Runs steps in parallel.
   *
   * @param parallelSteps list of lazy steps to run in parallel
   * @returns results of the functions run in parallel
   */
  protected async runParallel<TResults extends unknown[]>(parallelSteps: {
    [K in keyof TResults]: BaseLazyStep<TResults[K]>;
  }): Promise<TResults> {
    // get the step count before the parallel steps were added + 1
    // so if there are two initial steps followed by a parallel step,
    // initialStepCount would be 3.
    const initialStepCount = this.stepCount - (parallelSteps.length - 1);
    const parallelCallState = this.getParallelCallState(parallelSteps.length, initialStepCount);

    const sortedSteps = sortSteps(this.steps);

    // get the expected concurrency. Will be undefined in the `first` case.
    const plannedParallelStepCount = sortedSteps[initialStepCount + this.planStepCount]?.concurrent;

    if (parallelCallState !== "first" && plannedParallelStepCount !== parallelSteps.length) {
      // user has added/removed a parallel step
      throw new WorkflowError(
        `Incompatible number of parallel steps when call state was '${parallelCallState}'.` +
          ` Expected ${parallelSteps.length}, got ${plannedParallelStepCount} from the request.`
      );
    }

    await this.dispatchDebug("onInfo", {
      info:
        `Executing parallel steps with: ` +
        JSON.stringify({
          parallelCallState,
          initialStepCount,
          plannedParallelStepCount,
          stepCount: this.stepCount,
          planStepCount: this.planStepCount,
        }),
    });

    switch (parallelCallState) {
      case "first": {
        await submitParallelSteps({
          context: this.context,
          steps: parallelSteps,
          initialStepCount,
          invokeCount: this.invokeCount,
          telemetry: this.telemetry,
          dispatchDebug: this.dispatchDebug,
        });
        break;
      }
      case "partial": {
        /**
         * Being called by QStash to run one of the parallel steps. Last step in the steps list
         * indicates which step is to be run
         *
         * Execute the step and call QStash with the result
         */
        const planStep = this.steps.at(-1);
        if (!planStep || planStep.targetStep === undefined) {
          throw new WorkflowError(
            `There must be a last step and it should have targetStep larger than 0.` +
              `Received: ${JSON.stringify(planStep)}`
          );
        }
        const stepIndex = planStep.targetStep - initialStepCount;

        // even though we check for differences in the `last` case, we still need to check
        // here because it's not possible to detect name/type changes in sleep/sleepUntil
        // steps if we don't check here. This is because we wait after submitting the plan
        // step which has the _original step_ name/type but use the 'changed' step name/type
        // when submitting the _result step_.

        // So in the 'last' case it's not possible to detect step name/type changes for
        // sleep/sleepUntil. It's only possible here:
        validateStep(parallelSteps[stepIndex], planStep);
        try {
          const parallelStep = parallelSteps[stepIndex];
          const resultStep = await executeStep({
            lazyStep: parallelStep,
            stepId: planStep.targetStep,
            concurrency: parallelSteps.length,
            dispatchLifecycle: this.dispatchLifecycle,
          });
          await submitStepResult({
            context: this.context,
            lazyStep: parallelStep,
            resultStep,
            invokeCount: this.invokeCount,
            concurrency: parallelSteps.length,
            telemetry: this.telemetry,
            dispatchDebug: this.dispatchDebug,
          });
          throw new WorkflowAbort(parallelStep.stepName, resultStep);
        } catch (error) {
          if (
            isInstanceOf(error, WorkflowAbort) ||
            (isInstanceOf(error, QstashError) && error.status === 400) ||
            (isInstanceOf(error, QstashError) && error.status === 412)
          ) {
            throw error;
          }
          const wrappedError = new WorkflowError(
            `Error submitting steps to QStash in partial parallel step execution: ${error}`
          );
          // preserve the failing step name through the re-wrap so it still
          // reaches the error response header
          attachStepNameToError(wrappedError, parallelSteps[stepIndex].stepName);
          throw wrappedError;
        }
        break;
      }
      case "discard": {
        /**
         * We are still executing a parallel step but the last step is not a plan step, which means the parallel
         * execution is in progress (other parallel steps are still running) but one of the parallel steps has
         * called QStash with its result.
         *
         * This call to the API should be discarded: no operations are to be made. Parallel steps which are still
         * running will finish and call QStash eventually.
         */

        const resultStep = this.steps.at(-1)!;
        const lazyStep = parallelSteps.find(
          (planStep, index) => resultStep.stepId - index === initialStepCount
        );

        if (lazyStep) {
          await this.dispatchLifecycle("afterExecution", {
            stepName: lazyStep.stepName,
            result: lazyStep.parseOut(resultStep),
          });
        }

        throw new WorkflowAbort("discarded parallel");
      }
      case "last": {
        /**
         * All steps of the parallel execution have finished.
         *
         * validate the results and return them
         */

        const parallelResultSteps = sortedSteps
          .filter((step) => step.stepId >= initialStepCount) // filter out plan steps
          .slice(0, parallelSteps.length); // get the result steps of parallel run

        validateParallelSteps(parallelSteps, parallelResultSteps);

        const isLastMemoized =
          this.stepCount + 1 === this.nonPlanStepCount && this.steps.at(-1)!.stepId !== 0;
        if (isLastMemoized) {
          const resultStep = this.steps.at(-1)!;
          const lazyStep = parallelSteps.find(
            (planStep, index) => resultStep.stepId - index === initialStepCount
          )!;

          await this.dispatchLifecycle("afterExecution", {
            stepName: lazyStep.stepName,
            result: lazyStep.parseOut(resultStep),
          });
        }

        return parallelResultSteps.map((step, index) =>
          parallelSteps[index].parseOut(step)
        ) as TResults;
      }
    }
    const fillValue = undefined;
    return Array.from({ length: parallelSteps.length }).fill(fillValue) as TResults;
  }

  /**
   * Determines the parallel call state
   *
   * First filters the steps to get the steps which are after `initialStepCount` parameter.
   *
   * Depending on the remaining steps, decides the parallel state:
   * - "first": If there are no steps
   * - "last" If there are equal to or more than `2 * parallelStepCount`. We multiply by two
   *   because each step in a parallel execution will have 2 steps: a plan step and a result
   *   step.
   * - "partial": If the last step is a plan step
   * - "discard": If the last step is not a plan step. This means that the parallel execution
   *   is in progress (there are still steps to run) and one step has finished and submitted
   *   its result to QStash
   *
   * @param parallelStepCount number of steps to run in parallel
   * @param initialStepCount steps after the parallel invocation
   * @returns parallel call state
   */
  protected getParallelCallState(
    parallelStepCount: number,
    initialStepCount: number
  ): ParallelCallState {
    const remainingSteps = this.steps.filter(
      (step) => (step.targetStep || step.stepId) >= initialStepCount
    );

    if (remainingSteps.length === 0) {
      return "first";
    } else if (remainingSteps.length >= 2 * parallelStepCount) {
      // multipying by two since each step in parallel step will result in two
      // steps: one plan step and one result step. If there are 3 parallel steps
      // and steps list has at least 3*2=6 steps, the parallel steps have finished
      return "last";
    } else if (remainingSteps.at(-1)?.targetStep) {
      // if the last step is a plan step, it means the step corresponding to the
      // plan step will execute
      return "partial";
    } else {
      // if the call is not the first/last/partial, it means that it's the result
      // of one of the parallel calls but others are still running, meaning that
      // the current call should be discarded
      return "discard";
    }
  }

  /**
   * Get the promise by executing the lazt steps list. If there is a single
   * step, we call `runSingle`. Otherwise `runParallel` is called.
   *
   * @param lazyStepList steps list to execute
   * @returns promise corresponding to the execution
   */
  private getExecutionPromise(lazyStepList: BaseLazyStep[]): Promise<unknown> {
    return lazyStepList.length === 1
      ? this.runSingle(lazyStepList[0])
      : this.runParallel(lazyStepList);
  }

  /**
   * @param lazyStepList steps we executed
   * @param result result of the promise from `getExecutionPromise`
   * @param index index of the current step
   * @returns result[index] if lazyStepList > 1, otherwise result
   */
  private static getResult<TResult>(lazyStepList: BaseLazyStep[], result: unknown, index: number) {
    if (lazyStepList.length === 1) {
      return result as TResult;
    } else if (
      Array.isArray(result) &&
      lazyStepList.length === result.length &&
      index < lazyStepList.length
    ) {
      return result[index] as TResult;
    } else {
      throw new WorkflowError(
        `Unexpected parallel call result while executing step ${index}: '${result}'. Expected ${lazyStepList.length} many items`
      );
    }
  }

  private async deferExecution() {
    await Promise.resolve();
    await Promise.resolve();
  }
}

/**
 * Given a BaseLazyStep which is created during execution and a Step parsed
 * from the incoming request; compare the step names and types to make sure
 * that they are the same.
 *
 * Raises `WorkflowError` if there is a difference.
 *
 * @param lazyStep lazy step created during execution
 * @param stepFromRequest step parsed from incoming request
 */
const validateStep = (lazyStep: BaseLazyStep, stepFromRequest: Step): void => {
  // check step name
  if (lazyStep.stepName !== stepFromRequest.stepName) {
    throw new WorkflowError(
      `Incompatible step name. Expected '${lazyStep.stepName}',` +
        ` got '${stepFromRequest.stepName}' from the request`
    );
  }
  // check type name
  if (lazyStep.stepType !== stepFromRequest.stepType) {
    throw new WorkflowError(
      `Incompatible step type. Expected '${lazyStep.stepType}',` +
        ` got '${stepFromRequest.stepType}' from the request`
    );
  }
};

/**
 * validates that each lazy step and step from request has the same step
 * name and type using `validateStep` method.
 *
 * If there is a difference, raises `WorkflowError` with information
 * about the difference.
 *
 * @param lazySteps list of lazy steps created during parallel execution
 * @param stepsFromRequest list of steps corresponding to the parallel execution
 */
const validateParallelSteps = (lazySteps: BaseLazyStep[], stepsFromRequest: Step[]): void => {
  try {
    for (const [index, stepFromRequest] of stepsFromRequest.entries()) {
      validateStep(lazySteps[index], stepFromRequest);
    }
  } catch (error) {
    if (isInstanceOf(error, WorkflowError)) {
      const lazyStepNames = lazySteps.map((lazyStep) => lazyStep.stepName);
      const lazyStepTypes = lazySteps.map((lazyStep) => lazyStep.stepType);
      const requestStepNames = stepsFromRequest.map((step) => step.stepName);
      const requestStepTypes = stepsFromRequest.map((step) => step.stepType);
      throw new WorkflowError(
        `Incompatible steps detected in parallel execution: ${error.message}` +
          `\n  > Step Names from the request: ${JSON.stringify(requestStepNames)}` +
          `\n    Step Types from the request: ${JSON.stringify(requestStepTypes)}` +
          `\n  > Step Names expected: ${JSON.stringify(lazyStepNames)}` +
          `\n    Step Types expected: ${JSON.stringify(lazyStepTypes)}`
      );
    }
    throw error;
  }
};

/**
 * Given a set of steps, sorts them according to their `stepId`s. For plan steps,
 * `targetStep` field is used
 *
 * @param steps list of steps
 * @returns sorted steps
 */
const sortSteps = (steps: Step[]): Step[] => {
  const getStepId = (step: Step) => step.targetStep || step.stepId;
  return [...steps].sort((step, stepOther) => getStepId(step) - getStepId(stepOther));
};
