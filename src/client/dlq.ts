import { Client as QStashClient } from "@upstash/qstash";
import { DLQResumeRestartOptions, DLQResumeRestartResponse } from "./types";
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
  failureCallback: string;
  /**
   * status of the failure callback
   */
  failureCallbackInfo: FailureCallbackInfo;
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
  | "failureCallbackInfo"
>;

export class DLQ {
  constructor(private client: QStashClient) {}

  /**
   * list the items in the DLQ
   *
   * @param cursor - Optional cursor for pagination.
   * @param count - Optional number of items to return.
   * @param filter - Optional filter options to apply to the DLQ items.
   *    The available filter options are:
   *    - `fromDate`: Filter items which entered the DLQ after this date.
   *    - `toDate`: Filter items which entered the DLQ before this date.
   *    - `url`: Filter items by the URL they were sent to.
   *    - `responseStatus`: Filter items by the response status code.
   * @returns
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
   *  // other parameters...
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
  async resume(parameters: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  async resume(parameters: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async resume(parameters: DLQResumeRestartOptions) {
    const { headers, queryParams } = DLQ.handleDLQOptions(parameters);
    const { workflowRuns } = await this.client.http.request<{
      workflowRuns: DLQResumeRestartResponse[];
    }>({
      path: ["v2", "workflows", "dlq", `resume?${queryParams}`],
      headers,
      method: "POST",
    });

    if (Array.isArray(parameters.dlqId)) {
      return workflowRuns;
    }
    return workflowRuns[0];
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
   *  // other parameters...
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
  async restart(parameters: DLQResumeRestartOptions<string>): Promise<DLQResumeRestartResponse>;
  async restart(parameters: DLQResumeRestartOptions<string[]>): Promise<DLQResumeRestartResponse[]>;
  async restart(parameters: DLQResumeRestartOptions) {
    const { headers, queryParams } = DLQ.handleDLQOptions(parameters);
    const { workflowRuns } = await this.client.http.request<{
      workflowRuns: DLQResumeRestartResponse[];
    }>({
      path: ["v2", "workflows", "dlq", `restart?${queryParams}`],
      headers,
      method: "POST",
    });

    if (Array.isArray(parameters.dlqId)) {
      return workflowRuns;
    }
    return workflowRuns[0];
  }

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

  private static getDlqIdQueryParameter(dlqId: string | string[]): string {
    const dlqIds = Array.isArray(dlqId) ? dlqId : [dlqId];
    const paramsArray: [string, string][] = dlqIds.map((id) => ["dlqIds", id]);
    return new URLSearchParams(paramsArray).toString();
  }
}
