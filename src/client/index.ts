import { NotifyResponse, Waiter } from "../types";
import { Client as QStashClient } from "@upstash/qstash";
import {
  buildBulkActionQueryParameters,
  makeGetWaitersRequest,
  makeNotifyRequest,
  makeTriggerRequest,
  toNonEmptyIdArray,
} from "./utils";
import { getWorkflowRunId, serializeLabel, validateFlowControl, validateLabel } from "../utils";
import { getTriggerHeaders } from "../qstash/headers";
import { DLQ } from "./dlq";
import { TriggerOptions, TriggerResponse, WorkflowRunLogs } from "./types";
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
   * - By exact URL: `cancel({ filter: { workflowUrl: "https://..." } })`
   * - By URL prefix: `cancel({ filter: { workflowUrlStartingWith: "https://..." } })`
   * - With other filters: `cancel({ filter: { label: "my-label" } })`
   * - To target all: `cancel({ all: true })`
   *
   * Filters support multiple values: pass an array to match a run whose value
   * equals any of the given values (OR logic). Separate filters are combined with
   * AND logic. For example:
   * `cancel({ filter: { workflowUrl: ["https://a.com", "https://b.com"] } })`
   *
   * Cancels up to `count` workflow runs per call (defaults to 100).
   *
   * ```ts
   * const result = await client.cancel({ all: true, count: 50 });
   * ```
   */
  public async cancel(
    request: string | string[] | WorkflowRunCancelFilters
  ): Promise<{ cancelled: number }>;
  /** @deprecated Use `cancel(id)`, `cancel([id1, id2])`, `cancel({ filter: { workflowUrlStartingWith } })` instead. */
  public async cancel(request: {
    ids?: string | string[];
    urlStartingWith?: string;
    all?: true;
  }): Promise<{ cancelled: number }>;
  public async cancel(
    request:
      | string
      | string[]
      | WorkflowRunCancelFilters
      | { ids?: string | string[]; urlStartingWith?: string; all?: true }
  ): Promise<{ cancelled: number }> {
    // Legacy format: { ids?, urlStartingWith?, all? }
    if (
      typeof request === "object" &&
      !Array.isArray(request) &&
      ("ids" in request || "urlStartingWith" in request)
    ) {
      const legacy = request as { ids?: string | string[]; urlStartingWith?: string; all?: true };
      if (legacy.ids) {
        const ids = typeof legacy.ids === "string" ? [legacy.ids] : legacy.ids;
        return this.cancel(ids);
      }
      if (legacy.urlStartingWith) {
        return this.cancel({ filter: { workflowUrlStartingWith: legacy.urlStartingWith } });
      }
    }

    if (typeof request === "string" || Array.isArray(request)) {
      const ids = toNonEmptyIdArray(request, "Workflow run id");
      if (ids.length === 0) return { cancelled: 0 };
      request = ids;
    }
    const filters: WorkflowRunCancelFilters = Array.isArray(request)
      ? { workflowRunIds: request }
      : (request as WorkflowRunCancelFilters);

    return await this.client.http.request<{ cancelled: number }>({
      path: ["v2", "workflows", "runs"],
      method: "DELETE",
      query: buildBulkActionQueryParameters(filters, { translateWorkflowUrl: true }),
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
   * Optionally, you can pass a workflowRunId to enable lookback functionality:
   *
   * ```ts
   * await client.notify({
   *   eventId: "my-event-id",
   *   eventData: "my-data",
   *   workflowRunId: "wfr_123" // enables lookback
   * });
   * ```
   *
   * @param eventId event id to notify
   * @param eventData data to provide to the workflow
   * @param workflowRunId optional workflow run id for lookback support
   */
  public async notify({
    eventId,
    eventData,
    workflowRunId,
  }: {
    eventId: string;
    eventData?: unknown;
    workflowRunId?: string;
  }): Promise<NotifyResponse[]> {
    return await makeNotifyRequest(this.client.http, eventId, eventData, workflowRunId);
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
   * //   { workflowRunId: "wfr_my-workflow", workflowCreatedAt: 1735689600000 },
   * //   { workflowRunId: "wfr_my-workflow-2", workflowCreatedAt: 1735689600000 },
   * // ]
   * ```
   *
   * Runs are started with the batch trigger API, so a single request is sent
   * to QStash no matter how many runs are passed. All workflow run ids in a
   * batch must be unique.
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
   * @returns the started workflow run, or an array of them when an array is
   *   passed. `deduplicated` is set when a run with the same id already
   *   existed, in which case no new run was created.
   */

  public async trigger(params: TriggerOptions): Promise<TriggerResponse>;
  public async trigger(params: TriggerOptions[]): Promise<TriggerResponse[]>;

  public async trigger(
    params: TriggerOptions | TriggerOptions[]
  ): Promise<TriggerResponse | TriggerResponse[]> {
    const isBatchInput = Array.isArray(params);
    const options = isBatchInput ? params : [params];

    const workflowRunIds: string[] = [];
    const messages = options.map((option) => {
      validateLabel(option.label);
      validateFlowControl(option.flowControl);

      const workflowRunId = getWorkflowRunId(option.workflowRunId);
      workflowRunIds.push(workflowRunId);

      const headers = getTriggerHeaders({
        workflowRunId,
        workflowUrl: option.url,
        userHeaders: new Headers({
          ...(option.headers ?? {}),
          ...(option.label ? { [WORKFLOW_LABEL_HEADER]: serializeLabel(option.label) } : {}),
        }) as Headers,
        label: option.label,
        telemetry: option.disableTelemetry ? undefined : { sdk: SDK_TELEMETRY },
        retries: option.retries,
        retryDelay: option.retryDelay,
        flowControl: option.flowControl,
        delay: option.delay,
        notBefore: option.notBefore,
        failureUrl: option.failureUrl,
        redact: option.redact,
      });

      return {
        destination: option.url,
        body: typeof option.body === "string" ? option.body : JSON.stringify(option.body),
        headers,
      };
    });

    const responses = await makeTriggerRequest(this.client.http, messages);

    const results = workflowRunIds.map((workflowRunId, index) => {
      const response = responses[index];
      return {
        // a deduplicated run isn't created, so the server returns an empty id
        // for it. we fall back to the id we sent, which is the id of the run
        // that already exists.
        workflowRunId: response?.workflowRunId || workflowRunId,
        workflowCreatedAt: response?.workflowCreatedAt ?? 0,
        deduplicated: response?.deduplicated ?? false,
      };
    });

    return isBatchInput ? results : results[0];
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
    /** @deprecated Use `filter.workflowCreatedAt` instead. */
    workflowCreatedAt?: number;
  }): Promise<WorkflowRunLogs> {
    const { cursor, count, filter, ...legacyFilter } = params ?? {};

    return await this.client.http.request<WorkflowRunLogs>({
      path: ["v2", "workflows", "events"],
      query: {
        groupBy: "workflowRunId",
        ...legacyFilter,
        cursor,
        count,
        ...filter,
      },
    });
  }

  get dlq() {
    return new DLQ(this.client);
  }
}
