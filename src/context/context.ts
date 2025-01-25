import type {
  CallResponse,
  CallSettings,
  NotifyStepResponse,
  Telemetry,
  WaitEventOptions,
  WaitStepResponse,
  WorkflowClient,
} from "../types";
import { type StepFunction, type Step } from "../types";
import { AutoExecutor } from "./auto-executor";
import type { BaseLazyStep } from "./steps";
import {
  LazyCallStep,
  LazyFunctionStep,
  LazyNotifyStep,
  LazySleepStep,
  LazySleepUntilStep,
  LazyWaitForEventStep,
} from "./steps";
import type { WorkflowLogger } from "../logger";
import { DEFAULT_RETRIES } from "../constants";
import { WorkflowAbort } from "../error";
import type { Duration } from "../types";
import { WorkflowApi } from "./api";
import { WorkflowAgents } from "../agents";
import { Env, Hono } from "hono";

/**
 * Upstash Workflow context
 *
 * See the docs for fields and methods https://upstash.com/docs/qstash/workflows/basics/context
 */
export class WorkflowContext<
  TInitialPayload = unknown,
  Router extends Record<string, { payload: unknown; output: unknown }> = Record<string, { payload: unknown; output: unknown }>> {
  protected readonly executor: AutoExecutor;
  protected readonly steps: Step[];

  /**
   * QStash client of the workflow
   *
   * Can be overwritten by passing `qstashClient` parameter in `serve`:
   *
   * ```ts
   * import { Client } from "@upstash/qstash"
   *
   * export const POST = serve(
   *   async (context) => {
   *     ...
   *   },
   *   {
   *     qstashClient: new Client({...})
   *   }
   * )
   * ```
   */
  public readonly qstashClient: WorkflowClient;
  /**
   * Run id of the workflow
   */
  public readonly workflowRunId: string;
  /**
   * URL of the workflow
   *
   * Can be overwritten by passing a `url` parameter in `serve`:
   *
   * ```ts
   * export const POST = serve(
   *   async (context) => {
   *     ...
   *   },
   *   {
   *     url: "new-url-value"
   *   }
   * )
   * ```
   */
  public readonly url: string;
  /**
   * URL to call in case of workflow failure with QStash failure callback
   *
   * https://upstash.com/docs/qstash/features/callbacks#what-is-a-failure-callback
   *
   * Can be overwritten by passing a `failureUrl` parameter in `serve`:
   *
   * ```ts
   * export const POST = serve(
   *   async (context) => {
   *     ...
   *   },
   *   {
   *     failureUrl: "new-url-value"
   *   }
   * )
   * ```
   */
  public readonly failureUrl?: string;
  /**
   * Payload of the request which started the workflow.
   *
   * To specify its type, you can define `serve` as follows:
   *
   * ```ts
   * // set requestPayload type to MyPayload:
   * export const POST = serve<MyPayload>(
   *   async (context) => {
   *     ...
   *   }
   * )
   * ```
   *
   * By default, `serve` tries to apply `JSON.parse` to the request payload.
   * If your payload is encoded in a format other than JSON, you can utilize
   * the `initialPayloadParser` parameter:
   *
   * ```ts
   * export const POST = serve<MyPayload>(
   *   async (context) => {
   *     ...
   *   },
   *   {
   *     initialPayloadParser: (initialPayload) => {return doSomething(initialPayload)}
   *   }
   * )
   * ```
   */
  public readonly requestPayload: TInitialPayload;
  /**
   * headers of the initial request
   */
  public readonly headers: Headers;
  /**
   * Map of environment variables and their values.
   *
   * Can be set using the `env` option of serve:
   *
   * ```ts
   * export const POST = serve<MyPayload>(
   *   async (context) => {
   *     const key = context.env["API_KEY"];
   *   },
   *   {
   *     env: {
   *       "API_KEY": "*****";
   *     }
   *   }
   * )
   * ```
   *
   * Default value is set to `process.env`.
   */
  public readonly env: Record<string, string | undefined>;
  /**
   * Number of retries
   */
  public readonly retries: number;

  protected readonly router?: Hono<Env, Router>;

  constructor({
    qstashClient,
    workflowRunId,
    headers,
    steps,
    url,
    failureUrl,
    debug,
    initialPayload,
    env,
    retries,
    telemetry,
    router,
  }: {
    qstashClient: WorkflowClient;
    workflowRunId: string;
    headers: Headers;
    steps: Step[];
    url: string;
    failureUrl?: string;
    debug?: WorkflowLogger;
    initialPayload: TInitialPayload;
    env?: Record<string, string | undefined>;
    retries?: number;
    telemetry?: Telemetry;
    router?: Hono
  }) {
    this.qstashClient = qstashClient;
    this.workflowRunId = workflowRunId;
    this.steps = steps;
    this.url = url;
    this.failureUrl = failureUrl;
    this.headers = headers;
    this.requestPayload = initialPayload;
    this.env = env ?? {};
    this.retries = retries ?? DEFAULT_RETRIES;
    this.router = router

    this.executor = new AutoExecutor(this, this.steps, telemetry, debug);
  }

  /**
   * Executes a workflow step
   *
   * ```typescript
   * const result = await context.run("step 1", () => {
   *   return "result"
   * })
   * ```
   *
   * Can also be called in parallel and the steps will be executed
   * simulatenously:
   *
   * ```typescript
   * const [result1, result2] = await Promise.all([
   *   context.run("step 1", () => {
   *     return "result1"
   *   }),
   *   context.run("step 2", async () => {
   *     return await fetchResults()
   *   })
   * ])
   * ```
   *
   * @param stepName name of the step
   * @param stepFunction step function to be executed
   * @returns result of the step function
   */
  public async run<TResult>(
    stepName: string,
    stepFunction: StepFunction<TResult>
  ): Promise<TResult> {
    const wrappedStepFunction = (() =>
      this.executor.wrapStep(stepName, stepFunction)) as StepFunction<TResult>;
    return this.addStep<TResult>(new LazyFunctionStep(stepName, wrappedStepFunction));
  }

  /**
   * Stops the execution for the duration provided.
   *
   * ```typescript
   * await context.sleep('sleep1', 3) // wait for three seconds
   * ```
   *
   * @param stepName
   * @param duration sleep duration in seconds
   * @returns undefined
   */
  public async sleep(stepName: string, duration: number | Duration): Promise<void> {
    await this.addStep(new LazySleepStep(stepName, duration));
  }

  /**
   * Stops the execution until the date time provided.
   *
   * ```typescript
   * await context.sleepUntil('sleep1', Date.now() / 1000 + 3) // wait for three seconds
   * ```
   *
   * @param stepName
   * @param datetime time to sleep until. Can be provided as a number (in unix seconds),
   *   as a Date object or a string (passed to `new Date(datetimeString)`)
   * @returns undefined
   */
  public async sleepUntil(stepName: string, datetime: Date | string | number): Promise<void> {
    let time: number;
    if (typeof datetime === "number") {
      time = datetime;
    } else {
      datetime = typeof datetime === "string" ? new Date(datetime) : datetime;
      // get unix seconds
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      time = Math.round(datetime.getTime() / 1000);
    }
    await this.addStep(new LazySleepUntilStep(stepName, time));
  }

  /**
   * Makes a third party call through QStash in order to make a
   * network call without consuming any runtime.
   *
   * ```ts
   * const { status, body } = await context.call<string>(
   *   "post call step",
   *   {
   *     url: "https://www.some-endpoint.com/api",
   *     method: "POST",
   *     body: "my-payload"
   *   }
   * );
   * ```
   *
   * tries to parse the result of the request as JSON. If it's
   * not a JSON which can be parsed, simply returns the response
   * body as it is.
   *
   * @param stepName
   * @param url url to call
   * @param method call method. "GET" by default.
   * @param body call body
   * @param headers call headers
   * @param retries number of call retries. 0 by default
   * @param timeout max duration to wait for the endpoint to respond. in seconds.
   * @returns call result as {
   *     status: number;
   *     body: unknown;
   *     header: Record<string, string[]>
   *   }
   */
  public async call<TResult = unknown, TBody = unknown>(
    stepName: string,
    settings: CallSettings<TBody>
  ): Promise<CallResponse<TResult>> {
    const { url, method = "GET", body, headers = {}, retries = 0, timeout } = settings;

    const result = await this.addStep(
      new LazyCallStep<CallResponse<string> | string>(
        stepName,
        url,
        method,
        body,
        headers,
        retries,
        timeout
      )
    );

    // <for backwards compatibity>
    // if you transition to upstash/workflow from upstash/qstash,
    // the out field in the steps will be the body of the response.
    // we need to handle them explicitly here
    if (typeof result === "string") {
      try {
        const body = JSON.parse(result);
        return {
          status: 200,
          header: {},
          body,
        };
      } catch {
        return {
          status: 200,
          header: {},
          body: result as TResult,
        };
      }
    }
    // </for backwards compatibity>

    try {
      return {
        ...result,
        body: JSON.parse(result.body as string),
      };
    } catch {
      return result as CallResponse<TResult>;
    }
  }

  /**
   * Pauses workflow execution until a specific event occurs or a timeout is reached.
   *
   *```ts
   * const result = await workflow.waitForEvent("payment-confirmed", {
   *   timeout: "5m"
   * });
   *```
   *
   * To notify a waiting workflow:
   *
   * ```ts
   * import { Client } from "@upstash/workflow";
   *
   * const client = new Client({ token: "<QSTASH_TOKEN>" });
   *
   * await client.notify({
   *   eventId: "payment.confirmed",
   *   data: {
   *     amount: 99.99,
   *     currency: "USD"
   *   }
   * })
   * ```
   *
   * Alternatively, you can use the `context.notify` method.
   *
   * @param stepName
   * @param eventId - Unique identifier for the event to wait for
   * @param options - Configuration options.
   * @returns `{ timeout: boolean, eventData: unknown }`.
   *   The `timeout` property specifies if the workflow has timed out. The `eventData`
   *   is the data passed when notifying this workflow of an event.
   */
  public async waitForEvent(
    stepName: string,
    eventId: string,
    options: WaitEventOptions = {}
  ): Promise<WaitStepResponse> {
    const { timeout = "7d" } = options;

    const timeoutStr = typeof timeout === "string" ? timeout : `${timeout}s`;

    const result = await this.addStep(new LazyWaitForEventStep(stepName, eventId, timeoutStr));

    try {
      return {
        ...result,
        eventData: JSON.parse(result.eventData as string),
      };
    } catch {
      return result;
    }
  }

  /**
   * Notify workflow runs waiting for an event
   *
   * ```ts
   * const { eventId, eventData, notifyResponse } = await context.notify(
   *   "notify step", "event-id", "event-data"
   * );
   * ```
   *
   * Upon `context.notify`, the workflow runs waiting for the given eventId (context.waitForEvent)
   * will receive the given event data and resume execution.
   *
   * The response includes the same eventId and eventData. Additionally, there is
   * a notifyResponse field which contains a list of `Waiter` objects, each corresponding
   * to a notified workflow run.
   *
   * @param stepName
   * @param eventId event id to notify
   * @param eventData event data to notify with
   * @returns notify response which has event id, event data and list of waiters which were notified
   */
  public async notify(
    stepName: string,
    eventId: string,
    eventData: unknown
  ): Promise<NotifyStepResponse> {
    const result = await this.addStep(
      new LazyNotifyStep(stepName, eventId, eventData, this.qstashClient.http)
    );

    try {
      return {
        ...result,
        eventData: JSON.parse(result.eventData as string),
      };
    } catch {
      return result;
    }
  }

  /**
   * Cancel the current workflow run
   *
   * Will throw WorkflowAbort to stop workflow execution.
   * Shouldn't be inside try/catch.
   */
  public async cancel() {
    // throw an abort which will make the workflow cancel
    throw new WorkflowAbort("cancel", undefined, true);
  }

  /**
   * Adds steps to the executor. Needed so that it can be overwritten in
   * DisabledWorkflowContext.
   */
  protected async addStep<TResult = unknown>(step: BaseLazyStep<TResult>) {
    return await this.executor.addStep(step);
  }

  public get api() {
    return new WorkflowApi({
      context: this,
    });
  }

  public get agents() {
    return new WorkflowAgents({
      context: this,
    });
  }

  async invoke<K extends keyof Router>({
    function: fn,
    payload
  }: {
    function: K & string;
    payload?: Router[K]["payload"];
  }): Promise<Router[K]["output"]> {
    if (!this.router) throw new Error("Router not initialized");

    const res = await fetch(`${this.url}/${fn}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    return res.json() as Promise<Router[K]["output"]>
  }

}


