import type { NotifyStepResponse, WaitStepResponse, WorkflowClient } from "../types";
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
import type { HTTPMethods } from "@upstash/qstash";
import type { WorkflowLogger } from "../logger";
import { DEFAULT_RETRIES } from "../constants";

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
   * initial payload as a raw string
   */
  public readonly rawInitialPayload: string;
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

  constructor({
    qstashClient,
    workflowRunId,
    headers,
    steps,
    url,
    failureUrl,
    debug,
    initialPayload,
    rawInitialPayload,
    env,
    retries,
  }: {
    qstashClient: WorkflowClient;
    workflowRunId: string;
    headers: Headers;
    steps: Step[];
    url: string;
    failureUrl?: string;
    debug?: WorkflowLogger;
    initialPayload: TInitialPayload;
    rawInitialPayload?: string; // optional for tests
    env?: Record<string, string | undefined>;
    retries?: number;
  }) {
    this.qstashClient = qstashClient;
    this.workflowRunId = workflowRunId;
    this.steps = steps;
    this.url = url;
    this.failureUrl = failureUrl;
    this.headers = headers;
    this.requestPayload = initialPayload;
    this.rawInitialPayload = rawInitialPayload ?? JSON.stringify(this.requestPayload);
    this.env = env ?? {};
    this.retries = retries ?? DEFAULT_RETRIES;

    this.executor = new AutoExecutor(this, this.steps, debug);
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
   *   })
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
   * @param stepName
   * @param duration sleep duration in seconds
   * @returns undefined
   */
  public async sleep(stepName: string, duration: number): Promise<void> {
    await this.addStep(new LazySleepStep(stepName, duration));
  }

  /**
   * Stops the execution until the date time provided.
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
   * const postResult = await context.call<string>(
   *   "post call step",
   *   `https://www.some-endpoint.com/api`,
   *   "POST",
   *   "my-payload"
   * );
   * ```
   *
   * tries to parse the result of the request as JSON. If it's
   * not a JSON which can be parsed, simply returns the response
   * body as it is.
   *
   * @param stepName
   * @param url url to call
   * @param method call method
   * @param body call body
   * @param headers call headers
   * @returns call result (parsed as JSON if possible)
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  public async call<TResult = unknown, TBody = unknown>(
    stepName: string,
    url: string,
    method: HTTPMethods,
    body?: TBody,
    headers?: Record<string, string>
  ) {
    const result = await this.addStep(
      new LazyCallStep<string>(stepName, url, method, body, headers ?? {})
    );

    try {
      return JSON.parse(result) as TResult;
    } catch {
      return result as TResult;
    }
  }

  /**
   * Makes the workflow run wait until a notify request is sent or until the
   * timeout ends
   *
   * ```ts
   * const { eventData, timeout } = await context.waitForEvent(
   *   "wait for event step",
   *   "my-event-id",
   *   100 // timeout after 100 seconds
   * );
   * ```
   *
   * To notify a waiting workflow run, you can use the notify method:
   *
   * ```ts
   * import { Client } from "@upstash/workflow";
   *
   * const client = new Client({ token: });
   *
   * await client.notify({
   *   eventId: "my-event-id",
   *   eventData: "eventData"
   * })
   * ```
   *
   * @param stepName
   * @param eventId event id to wake up the waiting workflow run
   * @param timeout timeout duration in seconds
   * @returns wait response as `{ timeout: boolean, eventData: unknown }`.
   *   timeout is true if the wait times out, if notified it is false. eventData
   *   is the value passed to `client.notify`.
   */
  public async waitForEvent(
    stepName: string,
    eventId: string,
    timeout: string | number
  ): Promise<WaitStepResponse> {
    const result = await this.addStep(
      new LazyWaitForEventStep(
        stepName,
        eventId,
        typeof timeout === "string" ? timeout : `${timeout}s`
      )
    );

    return result;
  }

  public async notify(
    stepName: string,
    eventId: string,
    eventData: string
  ): Promise<NotifyStepResponse> {
    const result = await this.addStep(
      new LazyNotifyStep(
        stepName,
        eventId,
        eventData,
        this.qstashClient.http
      )
    );

    return result;
  }

  /**
   * Adds steps to the executor. Needed so that it can be overwritten in
   * DisabledWorkflowContext.
   */
  protected async addStep<TResult = unknown>(step: BaseLazyStep<TResult>) {
    return await this.executor.addStep(step);
  }
}
