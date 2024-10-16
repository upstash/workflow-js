import { NotifyResponse } from "../types";
import { Client as QStashClient } from "@upstash/qstash";

type ClientConfig = ConstructorParameters<typeof QStashClient>[0];

export class Client {
  private client: QStashClient;

  constructor(clientConfig: ClientConfig) {
    if (!clientConfig.token) {
      console.warn("[Upstash Workflow] url or the token is not set. client will not work.");
    }
    this.client = new QStashClient(clientConfig);
  }

  /**
   * Cancel an ongoing workflow
   *
   * @param workflowRunId run id of the workflow to delete
   * @returns true if workflow is succesfully deleted. Otherwise throws QStashError
   */
  public async cancel({ workflowRunId }: { workflowRunId: string }) {
    const result = (await this.client.http.request({
      path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=true`],
      method: "DELETE",
      parseResponseAsJson: false,
    })) as { error: string } | undefined;
    return result ?? true;
  }

  /**
   * Notify a workflow run waiting for an event
   *
   * @param eventId event id to notify
   * @param notifyBody data to provide to the workflow
   */
  public async notify({
    eventId,
    notifyBody,
  }: {
    eventId: string;
    notifyBody?: string;
  }): Promise<NotifyResponse[]> {
    const result = (await this.client.http.request({
      path: ["v2", "notify", eventId],
      method: "POST",
      body: notifyBody,
    })) as NotifyResponse[];

    return result;
  }
}
