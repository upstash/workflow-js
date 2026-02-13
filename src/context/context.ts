import type {
  CallResponse,
  CallSettings,
  LazyInvokeStepParams,
  NotifyStepResponse,
  Telemetry,
  WaitEventOptions,
  WaitStepResponse,
  WorkflowClient,
} from "../types";
import { type StepFunction, type Step } from "../types";
import { AutoExecutor } from "./auto-executor";
import type { BaseLazyStep, WaitForWebhookResponse, Webhook } from "./steps";
import {
  LazyCallStep,
  LazyCreateWebhookStep,
  LazyFunctionStep,
  LazyInvokeStep,
  LazyNotifyStep,
  LazySleepStep,
  LazySleepUntilStep,
  LazyWaitForEventStep,
  LazyWaitForWebhookStep,
} from "./steps";
import { WorkflowCancelAbort } from "../error";
import type { Duration } from "../types";
import { WorkflowApi } from "./api";
import { getNewUrlFromWorkflowId } from "../serve/serve-many";
import { MiddlewareManager } from "../middleware/manager";

/**
 * Upstash Workflow context
 *
 * See the docs for fields and methods https://upstash.com/docs/qstash/workflows/basics/context
 */
export class WorkflowContext<TInitialPayload = unknown> {
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
   * Creation time of the workflow run
   */
  public readonly workflowRunCreatedAt: number;
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
   * Label to apply to the workflow run.
   *
   * Can be used to filter the workflow run logs.
   *
   * Can be set by passing a `label` parameter when triggering the workflow
   * with `client.trigger`:
   *
   * ```ts
   * await client.trigger({
   *   url: "https://workflow-endpoint.com",
   *   label: "my-label"
   * });
   * ```
   */
  public readonly label?: string;

  constructor({
    qstashClient,
    workflowRunId,
    workflowRunCreatedAt,
    headers,
    steps,
    url,
    initialPayload,
    env,
    telemetry,
    invokeCount,
    label,
    middlewareManager,
  }: {
    qstashClient: WorkflowClient;
    workflowRunId: string;
    workflowRunCreatedAt: number;
    headers: Headers;
    steps: Step[];
    url: string;
    initialPayload: TInitialPayload;
    env?: Record<string, string | undefined>;
    telemetry?: Telemetry;
    invokeCount?: number;
    label?: string;
    middlewareManager?: MiddlewareManager<TInitialPayload>;
  }) {
    this.qstashClient = qstashClient;
    this.workflowRunId = workflowRunId;
    this.workflowRunCreatedAt = workflowRunCreatedAt;
    this.steps = steps;
    this.url = url;
    this.headers = headers;
    this.requestPayload = initialPayload;
    this.env = env ?? {};
    this.label = label;

    const middlewareManagerInstance =
      middlewareManager ?? new MiddlewareManager<TInitialPayload, unknown>([]);
    middlewareManagerInstance.assignContext(this);

    this.executor = new AutoExecutor(
      this,
      this.steps,
      middlewareManagerInstance.dispatchDebug.bind(middlewareManagerInstance),
      middlewareManagerInstance.dispatchLifecycle.bind(middlewareManagerInstance),
      telemetry,
      invokeCount
    );
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
    return await this.addStep<TResult>(new LazyFunctionStep(this, stepName, wrappedStepFunction));
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
    await this.addStep(new LazySleepStep(this, stepName, duration));
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
      time = Math.round(datetime.getTime() / 1000);
    }
    await this.addStep(new LazySleepUntilStep(this, stepName, time));
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
   * @param retryDelay delay / time gap between retries.
   * @param timeout max duration to wait for the endpoint to respond. in seconds.
   * @returns call result as {
   *     status: number;
   *     body: unknown;
   *     header: Record<string, string[]>
   *   }
   */
  public async call<TResult = unknown>(
    stepName: string,
    settings: CallSettings
  ): Promise<CallResponse<TResult>>;
  public async call<
    TResult extends { workflowRunId: string } = { workflowRunId: string },
    TBody = unknown,
  >(
    stepName: string,
    settings: LazyInvokeStepParams<TBody, unknown> & Pick<CallSettings, "timeout">
  ): Promise<CallResponse<TResult>>;
  public async call<TResult = unknown, TBody = unknown>(
    stepName: string,
    settings: CallSettings | (LazyInvokeStepParams<TBody, unknown> & Pick<CallSettings, "timeout">)
  ): Promise<CallResponse<TResult | { workflowRunId: string }>> {
    let callStep: LazyCallStep<TResult | { workflowRunId: string }>;
    if ("workflow" in settings) {
      const url = getNewUrlFromWorkflowId(this.url, settings.workflow.workflowId);
      const stringBody =
        typeof settings.body === "string"
          ? settings.body
          : settings.body === undefined // leave body as undefined if it's undefined
            ? undefined
            : JSON.stringify(settings.body);

      callStep = new LazyCallStep<{ workflowRunId: string }>({
        context: this,
        stepName,
        url,
        method: "POST",
        body: stringBody,
        headers: settings.headers || {},
        retries: settings.retries || 0,
        retryDelay: settings.retryDelay,
        timeout: settings.timeout,
        flowControl: settings.flowControl,
      });
    } else {
      callStep = new LazyCallStep<TResult>({
        context: this,
        stepName,
        url: settings.url,
        method: settings.method ?? "GET",
        body: settings.body,
        headers: settings.headers ?? {},
        retries: settings.retries ?? 0,
        retryDelay: settings.retryDelay,
        timeout: settings.timeout,
        flowControl: settings.flowControl,
      });
    }

    return await this.addStep(callStep);
  }

  /**
   * Pauses workflow execution until a specific event occurs or a timeout is reached.
   *
   *```ts
   * const result = await workflow.waitForEvent("payment-confirmed", "payment.confirmed", {
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
   * @returns `{ timeout: boolean, eventData: TEventData }`.
   *   The `timeout` property specifies if the workflow has timed out. The `eventData`
   *   is the data passed when notifying this workflow of an event.
   */
  public async waitForEvent<TEventData = unknown>(
    stepName: string,
    eventId: string,
    options: WaitEventOptions = {}
  ): Promise<WaitStepResponse<TEventData>> {
    const { timeout = "7d" } = options;

    const timeoutStr = typeof timeout === "string" ? timeout : `${timeout}s`;

    return await this.addStep(
      new LazyWaitForEventStep<TEventData>(this, stepName, eventId, timeoutStr)
    );
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
    return await this.addStep(
      new LazyNotifyStep(this, stepName, eventId, eventData, this.qstashClient.http)
    );
  }

  public async invoke<TInitialPayload, TResult>(
    stepName: string,
    settings: LazyInvokeStepParams<TInitialPayload, TResult>
  ) {
    return await this.addStep(
      new LazyInvokeStep<TResult, TInitialPayload>(this, stepName, settings)
    );
  }

  public async createWebhook(stepName: string): Promise<Webhook> {
    return await this.addStep(new LazyCreateWebhookStep(this, stepName));
  }

  public async waitForWebhook(
    stepName: string,
    webhook: Webhook,
    timeout: Duration
  ): Promise<WaitForWebhookResponse> {
    return await this.addStep(new LazyWaitForWebhookStep(this, stepName, webhook, timeout));
  }

  /**
   * Cancel the current workflow run
   *
   * Will throw WorkflowCancelAbort to stop workflow execution.
   * Shouldn't be inside try/catch.
   */
  public async cancel() {
    // throw an abort which will make the workflow cancel
    throw new WorkflowCancelAbort();
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
}
