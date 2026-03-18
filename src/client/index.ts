import { NotifyResponse, Waiter } from "../types";
import { Client as QStashClient } from "@upstash/qstash";
import {
  buildBulkActionQueryParameters,
  makeGetWaitersRequest,
  makeNotifyRequest,
  normalizeCursor,
} from "./utils";
import { getWorkflowRunId } from "../utils";
import { triggerFirstInvocation } from "../workflow-requests";
import { WorkflowContext } from "../context";
import { DLQ } from "./dlq";
import { TriggerOptions, WorkflowRunLogs } from "./types";
import { SDK_TELEMETRY, WORKFLOW_LABEL_HEADER } from "../constants";
import { WorkflowLogsListFilters, WorkflowRunCancelFilters } from "./filter-types";

type ClientConfig = ConstructorParameters<typeof QStashClient>[0];

/**
 * Workflow client for canceling & notifying workflows and getting waiters of an
 * event.
 *
 * ```ts
 * import { Client } from "@upstash/workflow";
 * const client = new Client({ token: "<QSTASH_TOKEN>" })
 * ```
 */
export class Client {
  private client: QStashClient;

  constructor(clientConfig: ClientConfig) {
    this.client = new QStashClient(clientConfig);
  }

  /**
   * Cancel an ongoing workflow.
   *
   * Can be called with:
   * - A single workflow run id: `cancel("wfr_123")`
   * - An array of workflow run ids: `cancel(["wfr_123", "wfr_456"])`
   * - A filter object: `cancel({ filter: { workflowUrl: "https://...", label: "my-label" } })`
   * - To target all: `cancel({ all: true })`
   *
   * Cancels up to `count` workflow runs per call (defaults to 100).
   *
   * ```ts
   * const result = await client.cancel({ all: true, count: 50 });
   * ```
   */
  public async cancel(
    request: string | string[] | WorkflowRunCancelFilters
  ): Promise<{ cancelled: number }> {
    if (typeof request === "string") request = [request];
    if (Array.isArray(request) && request.length === 0) return { cancelled: 0 };
    const filters: WorkflowRunCancelFilters = Array.isArray(request)
      ? { workflowRunIds: request }
      : request;

    return await this.client.http.request<{ cancelled: number }>({
      path: ["v2", "workflows", "runs"],
      method: "DELETE",
      query: buildBulkActionQueryParameters(filters),
    });
  }

  /**
   * Notify a workflow run waiting for an event
   *
   * ```ts
   * import { Client } from "@upstash/workflow";
   *
   * const client = new Client({ token: "<QSTASH_TOKEN>" })
   * await client.notify({
   *   eventId: "my-event-id",
   *   eventData: "my-data" // data passed to the workflow run
   * });
   * ```
   *
   * @param eventId event id to notify
   * @param eventData data to provide to the workflow
   */
  public async notify({
    eventId,
    eventData,
  }: {
    eventId: string;
    eventData?: unknown;
  }): Promise<NotifyResponse[]> {
    return await makeNotifyRequest(this.client.http, eventId, eventData);
  }

  /**
   * Check waiters of an event
   *
   * ```ts
   * import { Client } from "@upstash/workflow";
   *
   * const client = new Client({ token: "<QSTASH_TOKEN>" })
   * const result = await client.getWaiters({
   *   eventId: "my-event-id"
   * })
   * ```
   *
   * @param eventId event id to check
   */
  public async getWaiters({ eventId }: { eventId: string }): Promise<Required<Waiter>[]> {
    return await makeGetWaitersRequest(this.client.http, eventId);
  }

  /**
   * Trigger new workflow run and returns the workflow run id or an array of workflow run ids
   *
   * trigger a single workflow run:
   * ```ts
   * const { workflowRunId } = await client.trigger({
   *   url: "https://workflow-endpoint.com",
   *   body: "hello there!",         // Optional body
   *   headers: { ... },             // Optional headers
   *   workflowRunId: "my-workflow", // Optional workflow run ID
   *   retries: 3                    // Optional retries for the initial request
   *   retryDelay: "1000"            // Optional retry delay for the delay between retries
   * });
   *
   * console.log(workflowRunId)
   * // wfr_my-workflow
   * ```
   * trigger multiple workflow runs:
   * ```ts
   * const result = await client.trigger([
   *   {
   *   url: "https://workflow-endpoint.com",
   *   body: "hello there!",         // Optional body
   *   headers: { ... },             // Optional headers
   *   workflowRunId: "my-workflow", // Optional workflow run ID
   *   retries: 3                    // Optional retries for the initial request
   *   retryDelay: "1000"            // Optional retry delay for the delay between retries
   * },
   *   {
   *   url: "https://workflow-endpoint-2.com",
   *   body: "hello world!",           // Optional body
   *   headers: { ... },               // Optional headers
   *   workflowRunId: "my-workflow-2", // Optional workflow run ID
   *   retries: 5                      // Optional retries for the initial request
   *   retryDelay: "1000"              // Optional retry delay for the delay between retries
   * },
   * ]);
   *
   * console.log(result)
   * // [
   * //   { workflowRunId: "wfr_my-workflow" },
   * //   { workflowRunId: "wfr_my-workflow-2" },
   * // ]
   * ```
   *
   * @param url URL of the workflow
   * @param body body to start the workflow with
   * @param headers headers to use in the request
   * @param workflowRunId optional workflow run id to use. mind that
   *   you should pass different workflow run ids for different runs.
   *   The final workflowRunId will be `wfr_${workflowRunId}`, in
   *   other words: the workflow run id you pass will be prefixed
   *   with `wfr_`.
   * @param retries retry to use in the initial request. in the rest of
   *   the workflow, `retries` option of the `serve` will be used.
   * @param retryDelay delay between retries.
   * @param flowControl Settings for controlling the number of active requests
   *   and number of requests per second with the same key.
   * @param delay Delay for the workflow run. This is used to delay the
   *   execution of the workflow run. The delay is in seconds or can be passed
   *   as a string with a time unit (e.g. "1h", "30m", "15s").
   * @returns workflow run id or an array of workflow run ids
   */

  public async trigger(params: TriggerOptions): Promise<{ workflowRunId: string }>;
  public async trigger(params: TriggerOptions[]): Promise<{ workflowRunId: string }[]>;

  public async trigger(
    params: TriggerOptions | TriggerOptions[]
  ): Promise<{ workflowRunId: string } | { workflowRunId: string }[]> {
    const isBatchInput = Array.isArray(params);
    const options = isBatchInput ? params : [params];

    const invocations = options.map((option) => {
      const failureUrl = option.failureUrl ?? option.url;
      const finalWorkflowRunId = getWorkflowRunId(option.workflowRunId);

      const context = new WorkflowContext({
        qstashClient: this.client,
        headers: new Headers({
          ...(option.headers ?? {}),
          ...(option.label ? { [WORKFLOW_LABEL_HEADER]: option.label } : {}),
        }) as Headers,
        initialPayload: option.body,
        steps: [],
        url: option.url,
        workflowRunId: finalWorkflowRunId,
        telemetry: option.disableTelemetry ? undefined : { sdk: SDK_TELEMETRY },
        label: option.label,
      });

      return {
        workflowContext: context,
        telemetry: option.disableTelemetry ? undefined : { sdk: SDK_TELEMETRY },
        delay: option.delay,
        notBefore: option.notBefore,
        failureUrl,
        retries: option.retries,
        retryDelay: option.retryDelay,
        flowControl: option.flowControl,
      };
    });
    const result = await triggerFirstInvocation(invocations);

    const workflowRunIds: string[] = invocations.map(
      (invocation) => invocation.workflowContext.workflowRunId
    );

    if (result.isOk()) {
      return isBatchInput
        ? workflowRunIds.map((id) => ({ workflowRunId: id }))
        : { workflowRunId: workflowRunIds[0] };
    } else {
      throw result.error;
    }
  }

  /**
   * Fetches logs for workflow runs.
   *
   * @param workflowRunId - The ID of the workflow run to fetch logs for.
   * @param cursor - The cursor for pagination.
   * @param count - Number of runs to fetch. Default value is 10.
   * @param state - The state of the workflow run.
   * @param workflowUrl - The URL of the workflow. Should be an exact match.
   * @param workflowCreatedAt - The creation time of the workflow. If you have two workflow runs with the same URL, you can use this to filter them.
   * @returns A promise that resolves to either a `WorkflowRunLog` or a `WorkflowRunResponse`.
   *
   * @example
   * Fetch logs for a specific workflow run:
   * ```typescript
   * const { runs } = await client.logs({ workflowRunId: '12345' });
   * const steps = runs[0].steps; // access steps
   * ```
   *
   * @example
   * Fetch logs with pagination:
   * ```typescript
   * const { runs, cursor } = await client.logs();
   * const steps = runs[0].steps // access steps
   *
   * const { runs: nextRuns, cursor: nextCursor } = await client.logs({ cursor, count: 2 });
   * ```
   */
  public async logs(params?: {
    cursor?: string;
    count?: number;
    filter?: WorkflowLogsListFilters;
    /** @deprecated Use `filter.workflowRunId` instead. */
    workflowRunId?: string;
    /** @deprecated Use `filter.state` instead. */
    state?: string;
    /** @deprecated Use `filter.workflowUrl` instead. */
    workflowUrl?: string;
    /** @deprecated Use `filter.label` instead. */
    label?: string;
    /** @deprecated No longer supported. */
    workflowCreatedAt?: number;
  }): Promise<WorkflowRunLogs> {
    const { cursor, count, filter, ...legacyFilter } = params ?? {};

    return normalizeCursor(
      await this.client.http.request<WorkflowRunLogs>({
        path: ["v2", "workflows", "events"],
        query: {
          groupBy: "workflowRunId",
          ...legacyFilter,
          cursor,
          count,
          ...filter,
        },
      })
    );
  }

  get dlq() {
    return new DLQ(this.client);
  }
}
