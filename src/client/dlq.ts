import { Client as QStashClient, FlowControl } from "@upstash/qstash";
import { DLQResumeRestartOptions, DLQResumeRestartResponse } from "./types";
import { buildBulkActionQueryParameters, normalizeCursor } from "./utils";
import { WorkflowDLQActionFilters, WorkflowDLQListFilters } from "./filter-types";
import { prepareFlowControl } from "../qstash/headers";

type ResumeRestartOptions = {
  flowControl?: FlowControl;
  retries?: number;
};

type FailureCallbackInfo = {
  state?: "CALLBACK_FAIL" | "CALLBACK_SUCCESS" | "CALLBACK_INPROGRESS";
  responseStatus?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string[]>;
};

type DLQMessage = {
  messageId: string;
  /**
   * URL of the workflow
   */
  url: string;
  method: string;
  header: Record<string, string[]>;
  body: string;
  maxRetries: number;
  notBefore: number;
  createdAt: number;
  callerIP: string;
  workflowRunId: string;
  workflowCreatedAt: number;
  workflowUrl: string;
  responseStatus: number;
  responseHeader: Record<string, string[]>;
  responseBody: string;
  dlqId: string;
  /**
   * URL of the failure callback
   */
  failureCallback?: string;
  /**
   * status of the failure callback
   */
  failureCallbackInfo?: FailureCallbackInfo;
  /**
   * label passed when triggering workflow
   */
  label?: string;
};

type PublicDLQMessage = Pick<
  DLQMessage,
  | "header"
  | "body"
  | "maxRetries"
  | "notBefore"
  | "createdAt"
  | "callerIP"
  | "workflowRunId"
  | "workflowCreatedAt"
  | "workflowUrl"
  | "responseStatus"
  | "responseHeader"
  | "responseBody"
  | "dlqId"
  | "failureCallback"
  | "failureCallbackInfo"
  | "label"
>;

function buildResumeRestartHeaders(options?: ResumeRestartOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options?.flowControl) {
    const { flowControlKey, flowControlValue } = prepareFlowControl(options.flowControl);
    headers["Upstash-Flow-Control-Key"] = flowControlKey;
    headers["Upstash-Flow-Control-Value"] = flowControlValue;
  }
  if (options?.retries !== undefined) {
    headers["Upstash-Retries"] = options.retries.toString();
  }
  return headers;
}

export class DLQ {
  constructor(private client: QStashClient) {}

  /**
   * list the items in the DLQ
   *
   * @param parameters - Optional parameters object
   * @param parameters.cursor - Optional cursor for pagination
   * @param parameters.count - Optional number of items to return
   * @param parameters.filter - Optional filter options to apply to the DLQ items.
   *    The available filter options are:
   *    - `fromDate`: Filter items which entered the DLQ after this date.
   *    - `toDate`: Filter items which entered the DLQ before this date.
   *    - `url`: Filter items by the URL they were sent to.
   *    - `responseStatus`: Filter items by the response status code.
   *    - `workflowRunId`: Filter items by workflow run ID.
   *    - `workflowCreatedAt`: Filter items by workflow creation time.
   *    - `failureFunctionState`: Filter items by failure callback state.
   *    - `label`: Filter items by label.
   */
  async list(parameters?: { cursor?: string; count?: number; filter?: WorkflowDLQListFilters }) {
    const { cursor, count, filter } = parameters || {};
    return normalizeCursor(
      (await this.client.http.request({
        path: ["v2", "dlq"],
        method: "GET",
        query: {
          cursor,
          count,
          ...filter,
          source: "workflow",
        },
      })) as { messages: PublicDLQMessage[]; cursor?: string }
    );
  }

  /**
   * Resumes the workflow run for the given DLQ message(s).
   *
   * Resuming means that the new workflow run will start executing from where
   * the original workflow run failed, using the same input and context.
   *
   * If you want to restart the workflow run from the beginning, use
   * `restart` method instead.
   *
   * Can be called with:
   * - A single dlqId: `resume("id")`
   * - An array of dlqIds: `resume(["id1", "id2"])`
   * - A filter object: `resume({ filter: { label: "my-label", fromDate: 1640995200000 } })`
   * - To target all entries: `resume({ all: true })`
   *
   * Processes up to `count` messages per call (defaults to 100).
   * Call in a loop until cursor is undefined to process all:
   *
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const result = await client.dlq.resume({ all: true, count: 100, cursor });
   *   cursor = result.cursor;
   * } while (cursor);
   * ```
   */
  async resume(
    request: string | string[] | WorkflowDLQActionFilters,
    options?: ResumeRestartOptions
  ): Promise<{ cursor?: string; workflowRuns: DLQResumeRestartResponse[] }>;
  /** @deprecated Use `resume(dlqId)` instead */
  async resume(request: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  /** @deprecated Use `resume([dlqId1, dlqId2])` instead */
  async resume(request: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async resume(
    request: string | string[] | WorkflowDLQActionFilters | DLQResumeRestartOptions,
    options?: ResumeRestartOptions
  ): Promise<
    | { cursor?: string; workflowRuns: DLQResumeRestartResponse[] }
    | DLQResumeRestartResponse
    | DLQResumeRestartResponse[]
  > {
    // Legacy format: { dlqId, flowControl?, retries? }
    if (typeof request === "object" && !Array.isArray(request) && "dlqId" in request) {
      const { dlqId, flowControl, retries } = request as DLQResumeRestartOptions;

      const dlqIds = Array.isArray(dlqId) ? dlqId : [dlqId];
      const { workflowRuns } = await this.client.http.request<{
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "resume"],
        query: { dlqIds },
        method: "POST",
        headers: buildResumeRestartHeaders({ flowControl, retries }),
      });

      return Array.isArray(dlqId) ? workflowRuns : workflowRuns[0];
    }

    // New format
    if (typeof request === "string") request = [request];
    if (Array.isArray(request) && request.length === 0) return { workflowRuns: [] };
    const filters: WorkflowDLQActionFilters = Array.isArray(request)
      ? { dlqIds: request }
      : request;

    return normalizeCursor(
      await this.client.http.request<{
        cursor?: string;
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "resume"],
        query: buildBulkActionQueryParameters(filters),
        method: "POST",
        headers: buildResumeRestartHeaders(options),
      })
    );
  }

  /**
   * Restarts the workflow run for the given DLQ message(s).
   *
   * Restarting means that the new workflow run will start executing from the
   * beginning with the same initial payload and configuration.
   *
   * If you want to resume the workflow run from where it failed, use
   * `resume` method instead.
   *
   * Can be called with:
   * - A single dlqId: `restart("id")`
   * - An array of dlqIds: `restart(["id1", "id2"])`
   * - A filter object: `restart({ filter: { label: "my-label", fromDate: 1640995200000 } })`
   * - To target all entries: `restart({ all: true })`
   *
   * Processes up to `count` messages per call (defaults to 100).
   * Call in a loop until cursor is undefined to process all:
   *
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const result = await client.dlq.restart({ all: true, count: 100, cursor });
   *   cursor = result.cursor;
   * } while (cursor);
   * ```
   */
  async restart(
    request: string | string[] | WorkflowDLQActionFilters,
    options?: ResumeRestartOptions
  ): Promise<{ cursor?: string; workflowRuns: DLQResumeRestartResponse[] }>;
  /** @deprecated Use `restart(dlqId)` instead */
  async restart(request: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  /** @deprecated Use `restart([dlqId1, dlqId2])` instead */
  async restart(request: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async restart(
    request: string | string[] | WorkflowDLQActionFilters | DLQResumeRestartOptions,
    options?: ResumeRestartOptions
  ): Promise<
    | { cursor?: string; workflowRuns: DLQResumeRestartResponse[] }
    | DLQResumeRestartResponse
    | DLQResumeRestartResponse[]
  > {
    // Legacy format: { dlqId, flowControl?, retries? }
    if (typeof request === "object" && !Array.isArray(request) && "dlqId" in request) {
      const { dlqId, flowControl, retries } = request as DLQResumeRestartOptions;

      const dlqIds = Array.isArray(dlqId) ? dlqId : [dlqId];
      const { workflowRuns } = await this.client.http.request<{
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "restart"],
        query: { dlqIds },
        method: "POST",
        headers: buildResumeRestartHeaders({ flowControl, retries }),
      });

      return Array.isArray(dlqId) ? workflowRuns : workflowRuns[0];
    }

    // New format
    if (typeof request === "string") request = [request];
    if (Array.isArray(request) && request.length === 0) return { workflowRuns: [] };
    const filters: WorkflowDLQActionFilters = Array.isArray(request)
      ? { dlqIds: request }
      : request;

    return normalizeCursor(
      await this.client.http.request<{
        cursor?: string;
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "restart"],
        query: buildBulkActionQueryParameters(filters),
        method: "POST",
        headers: buildResumeRestartHeaders(options),
      })
    );
  }

  /**
   * Retry the failure callback of a workflow run whose failureUrl/failureFunction
   * request has failed.
   *
   * @param dlqId - The ID of the DLQ message to retry
   * @returns response with workflow run information
   */
  async retryFailureFunction({ dlqId }: Pick<DLQResumeRestartOptions<string>, "dlqId">) {
    const response = await this.client.http.request<DLQResumeRestartResponse>({
      path: ["v2", "workflows", "dlq", "callback", dlqId],
      method: "POST",
    });

    return response;
  }

  /**
   * Delete DLQ messages.
   *
   * Can be called with:
   * - A single dlqId: `delete("id")`
   * - An array of dlqIds: `delete(["id1", "id2"])`
   * - A filter object: `delete({ filter: { label: "my-label", fromDate: 1640995200000 } })`
   * - To target all entries: `delete({ all: true })`
   *
   * Processes up to `count` messages per call (defaults to 100).
   * Call in a loop until cursor is undefined to process all:
   *
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const result = await client.dlq.delete({ all: true, count: 100, cursor });
   *   cursor = result.cursor;
   * } while (cursor);
   * ```
   */
  async delete(request: string | string[] | WorkflowDLQActionFilters) {
    if (typeof request === "string") request = [request];
    if (Array.isArray(request) && request.length === 0) return { deleted: 0 };
    const filters: WorkflowDLQActionFilters = Array.isArray(request)
      ? { dlqIds: request }
      : request;

    return normalizeCursor(
      await this.client.http.request<{ cursor?: string; deleted: number }>({
        path: ["v2", "workflows", "dlq"],
        method: "DELETE",
        query: buildBulkActionQueryParameters(filters),
      })
    );
  }
}
