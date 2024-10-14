import { NotifyResponse } from "../types";
import { Client } from "@upstash/qstash"

type ClientConfig = ConstructorParameters<typeof Client>[0];

export class WorkflowClient {
  private client: Client

  constructor(clientConfig: ClientConfig) {
    if (!clientConfig.baseUrl || !clientConfig.token) {
      console.warn("[Upstash Workflow] url or the token is not set. client will not work.");
    };
    this.client = new Client(clientConfig)
  }

  /**
   * Cancel an ongoing workflow
   *
   * @param workflowRunId run id of the workflow to delete
   * @returns true if workflow is succesfully deleted. Otherwise throws QStashError
   */
  public async cancel(workflowRunId: string) {
    const result = (await this.client.http.request({
      path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=true`],
      method: "DELETE",
      parseResponseAsJson: false,
    })) as { error: string } | undefined;
    return result ?? true;
  }

  /**
   * Notify waiting 
   * 
   * @param eventId 
   * @param notifyData 
   */
  public async notify(eventId: string, notifyData: string): Promise<NotifyResponse[]> {

    const result = (await this.client.http.request({
      path: ["v2", "notify", eventId],
      method: "POST",
      body: notifyData
    })) as NotifyResponse[];

    return result
  }
}
