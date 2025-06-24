import { Client as QStashClient } from "@upstash/qstash";

type QStashDLQFilterOptions = NonNullable<
  Required<Parameters<QStashClient["dlq"]["listMessages"]>[0]>
>["filter"];

type DLQFilterOptions = Pick<
  QStashDLQFilterOptions,
  "fromDate" | "toDate" | "url" | "responseStatus"
>;

type DLQMessage = {
  messageId: string;
  url: string;
  method: string;
  header: object;
  body: string;
  maxRetries: number;
  notBefore: number;
  createdAt: number;
  callerIP: string;
  workflowRunId: string;
  workflowCreatedAt: number;
  workflowUrl: string;
  responseStatus: number;
  responseHeader: object;
  responseBody: string;
  dlqId: string;
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
>;

export class DLQ {
  constructor(private client: QStashClient) {}

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

  async resume(parameters: { dlqId: string; workflowRunId?: string }) {
    const { dlqId, workflowRunId: userWorkflowRunId } = parameters;
    const { workflowCreatedAt, workflowRunId } = await this.client.http.request<{
      workflowRunId: string;
      workflowCreatedAt: string;
    }>({
      path: ["v2", "workflows", "dlq", "resume", dlqId],
      headers: this.getHeaders(userWorkflowRunId),
      method: "POST",
    });
    return { workflowCreatedAt, workflowRunId };
  }

  async restart(parameters: { dlqId: string; workflowRunId?: string }) {
    const { dlqId, workflowRunId: userWorkflowRunId } = parameters;
    const { workflowCreatedAt, workflowRunId } = await this.client.http.request<{
      workflowRunId: string;
      workflowCreatedAt: string;
    }>({
      path: ["v2", "workflows", "dlq", "restart", dlqId],
      headers: this.getHeaders(userWorkflowRunId),
      method: "POST",
    });
    return { workflowCreatedAt, workflowRunId };
  }

  private getHeaders(workflowRunId?: string): Record<string, string> {
    return workflowRunId
      ? {
          "Upstash-Workflow-RunId": `wfr_${workflowRunId}`,
        }
      : {};
  }
}
