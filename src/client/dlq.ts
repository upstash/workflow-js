import { Client as QStashClient } from "@upstash/qstash";
import { DLQResumeRestartOptions, DLQResumeRestartResponse, WorkflowBulkFilters } from "./types";
import { prepareFlowControl } from "../qstash/headers";

type QStashDLQFilterOptions = NonNullable<
  Required<Parameters<QStashClient["dlq"]["listMessages"]>[0]>
>["filter"];

type DLQFilterOptions = Pick<
  QStashDLQFilterOptions,
  "fromDate" | "toDate" | "url" | "responseStatus"
> & {
  workflowRunId?: string;
  workflowCreatedAt?: string;
  failureFunctionState?: FailureCallbackInfo["state"];
  label?: string;
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

export class DLQ {
  constructor(private client: QStashClient) { }

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
  async list(parameters?: { cursor?: string; count?: number; filter?: DLQFilterOptions }) {
    const { cursor, count, filter } = parameters || {};
    return (await this.client.http.request({
      path: ["v2", "dlq"],
      method: "GET",
      query: {
        cursor,
        count,
        ...filter,
        source: "workflow",
      },
    })) as { messages: PublicDLQMessage[]; cursor?: string };
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
   * Example with a single DLQ ID:
   * ```ts
   * const response = await client.dlq.resume({
   *   dlqId: "dlq-12345",
   *   flowControl: {
   *     key: "my-flow-control-key",
   *     value: "my-flow-control-value",
   *   },
   *   retries: 3,
   * });
   *
   * console.log(response.workflowRunId); // ID of the new workflow run
   * ```
   *
   * Example with multiple DLQ IDs:
   * ```ts
   * const response = await client.dlq.resume({
   *  dlqId: ["dlq-12345", "dlq-67890"],
   * });
   * console.log(response[0].workflowRunId); // ID of the first workflow run
   * console.log(response[1].workflowRunId); // ID of the second workflow run
   * ```
   *
   * if the dlqId is not found, throws an error.
   *
   * @param dlqId - The ID(s) of the DLQ message(s) to resume.
   * @param flowControl - Optional flow control parameters. If not passed, flow
   *     control of the failing workflow will be used
   * @param retries - Optional number of retries to perform if the request fails.
   *     If not passed, retries settings of the failing workflow will be used.
   * @returns run id and creation time of the new workflow run(s).
   */
  async resume(request: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  async resume(request: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async resume(request: WorkflowBulkFilters): Promise<DLQResumeRestartResponse[]>;

  async resume(
    request: DLQResumeRestartOptions | WorkflowBulkFilters
  ): Promise<DLQResumeRestartResponse | DLQResumeRestartResponse[]> {
    // Filter-based resume
    if (!("dlqId" in request)) {
      const { workflowRuns } = await this.client.http.request<{
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "resume"],
        headers: { "Content-Type": "application/json" },
        body: request.all ? JSON.stringify({}) : JSON.stringify({
          ...request,
          ...(request.fromDate ? { fromDate: Number(request.fromDate) } : {}),
          ...(request.toDate ? { toDate: Number(request.toDate) } : {}),
        }),
        method: "POST",
      });
      return workflowRuns;
    }

    // DLQ ID-based resume
    const { headers, queryParams } = DLQ.handleDLQOptions(request);
    const path = queryParams ? `resume?${queryParams}` : "resume";
    const { workflowRuns } = await this.client.http.request<{
      workflowRuns: DLQResumeRestartResponse[];
    }>({
      path: ["v2", "workflows", "dlq", path],
      headers,
      method: "POST",
    });

    // Return single response for string dlqId, array for array dlqId
    return typeof request.dlqId === "string" ? workflowRuns[0] : workflowRuns;
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
   * Example with a single DLQ ID:
   * ```ts
   * const response = await client.dlq.restart({
   *   dlqId: "dlq-12345",
   *   flowControl: {
   *     key: "my-flow-control-key",
   *     value: "my-flow-control-value",
   *   },
   *   retries: 3,
   * });
   *
   * console.log(response.workflowRunId); // ID of the new workflow run
   * ```
   *
   * Example with multiple DLQ IDs:
   * ```ts
   * const response = await client.dlq.restart({
   *  dlqId: ["dlq-12345", "dlq-67890"],
   * });
   * console.log(response[0].workflowRunId); // ID of the first workflow run
   * console.log(response[1].workflowRunId); // ID of the second workflow run
   * ```
   *
   * if the dlqId is not found, throws an error.
   *
   * @param dlqId - The ID(s) of the DLQ message(s) to restart.
   * @param flowControl - Optional flow control parameters. If not passed, flow
   *     control of the failing workflow will be used
   * @param retries - Optional number of retries to perform if the request fails.
   *     If not passed, retries settings of the failing workflow will be used.
   * @returns run id and creation time of the new workflow run(s).
   */
  async restart(request: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  async restart(request: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async restart(request: WorkflowBulkFilters): Promise<DLQResumeRestartResponse[]>;

  async restart(
    request: DLQResumeRestartOptions | WorkflowBulkFilters
  ): Promise<DLQResumeRestartResponse | DLQResumeRestartResponse[]> {
    // Filter-based restart
    if (!("dlqId" in request)) {
      const { workflowRuns } = await this.client.http.request<{
        workflowRuns: DLQResumeRestartResponse[];
      }>({
        path: ["v2", "workflows", "dlq", "restart"],
        headers: { "Content-Type": "application/json" },
        body: request.all ? JSON.stringify({}) : JSON.stringify({
          ...request,
          ...(request.fromDate ? { fromDate: Number(request.fromDate) } : {}),
          ...(request.toDate ? { toDate: Number(request.toDate) } : {}),
        }),
        method: "POST",
      });
      return workflowRuns;
    }

    // DLQ ID-based restart
    const { headers, queryParams } = DLQ.handleDLQOptions(request);
    const path = queryParams ? `restart?${queryParams}` : "restart";
    const { workflowRuns } = await this.client.http.request<{
      workflowRuns: DLQResumeRestartResponse[];
    }>({
      path: ["v2", "workflows", "dlq", path],
      headers,
      method: "POST",
    });

    // Return single response for string dlqId, array for array dlqId
    return typeof request.dlqId === "string" ? workflowRuns[0] : workflowRuns;
  }

  /**
   * Retry the failure callback of a workflow run whose failureUrl/failureFunction
   * request has failed.
   *
   * @param dlqId - The ID of the DLQ message to retry
   * @returns response with workflow run information
   */
  async retryFailureFunction({ dlqId }: Pick<DLQResumeRestartOptions<string>, "dlqId">) {
    const { workflowRuns } = await this.client.http.request<{
      workflowRuns: DLQResumeRestartResponse[];
    }>({
      path: ["v2", "workflows", "dlq", "callback", dlqId],
      method: "POST",
    });

    return workflowRuns[0];
  }

  /**
   * Delete DLQ messages.
   *
   * Can be called with:
   * - A single dlqId: `delete("id")`
   * - An array of dlqIds: `delete(["id1", "id2"])`
   * - An object with dlqIds: `delete({ dlqIds: ["id1", "id2"] })`
   * - A filter object: `delete({ label: "my-label", fromDate: "..." })`
   */
  async delete(
    request: string | string[] | { dlqIds: string | string[] } | WorkflowBulkFilters
  ): Promise<{ deleted: number }> {
    // Handle string or string[] - direct dlqIds
    if (typeof request === "string" || Array.isArray(request)) {
      const queryParams = DLQ.getDlqIdQueryParameter(request);
      const path = queryParams ? `dlq?${queryParams}` : "dlq";
      return await this.client.http.request<{ deleted: number }>({
        path: ["v2", "workflows", path],
        method: "DELETE",
      });
    }

    // Handle object with dlqIds
    if ("dlqIds" in request) {
      const queryParams = DLQ.getDlqIdQueryParameter(request.dlqIds);
      const path = queryParams ? `dlq?${queryParams}` : "dlq";
      return await this.client.http.request<{ deleted: number }>({
        path: ["v2", "workflows", path],
        method: "DELETE",
      });
    }

    // Handle filters (WorkflowBulkFilters)
    return await this.client.http.request<{ deleted: number }>({
      path: ["v2", "workflows", "dlq"],
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: request.all ? JSON.stringify({}) : JSON.stringify({
        ...request,
        ...(request.fromDate ? { fromDate: Number(request.fromDate) } : {}),
        ...(request.toDate ? { toDate: Number(request.toDate) } : {}),
      }),
    });
  }

  /**
   * Handles DLQ options and prepares headers and query parameters.
   *
   * @param options - DLQ resume/restart options
   */
  private static handleDLQOptions(options: DLQResumeRestartOptions) {
    const { dlqId, flowControl, retries } = options;

    const headers: Record<string, string> = {};
    if (flowControl) {
      const { flowControlKey, flowControlValue } = prepareFlowControl(flowControl);
      headers["Upstash-Flow-Control-Key"] = flowControlKey;
      headers["Upstash-Flow-Control-Value"] = flowControlValue;
    }

    if (retries !== undefined) {
      headers["Upstash-Retries"] = retries.toString();
    }

    return {
      queryParams: DLQ.getDlqIdQueryParameter(dlqId),
      headers,
    };
  }

  /**
   * Converts DLQ ID(s) to query parameter string.
   *
   * @param dlqId - Single DLQ ID or array of DLQ IDs
   */
  private static getDlqIdQueryParameter(dlqId: string | string[]): string {
    const dlqIds = Array.isArray(dlqId) ? dlqId : [dlqId];
    const paramsArray: [string, string][] = dlqIds.map((id) => ["dlqIds", id]);
    return new URLSearchParams(paramsArray).toString();
  }
}
