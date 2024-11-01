import { NotifyResponse, Waiter } from "../types";
import { Client as QStashClient } from "@upstash/qstash";
import { makeCancelRequest, makeGetWaitersRequest, makeNotifyRequest } from "./utils";

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
    if (!clientConfig.token) {
      console.warn("[Upstash Workflow] url or the token is not set. client will not work.");
    }
    this.client = new QStashClient(clientConfig);
  }

  /**
   * Cancel an ongoing workflow
   *
   * Returns true if workflow is canceled succesfully. Otherwise, throws error.
   *
   * ```ts
   * import { Client } from "@upstash/workflow";
   *
   * const client = new Client({ token: "<QSTASH_TOKEN>" })
   * await client.cancel({ workflowRunId: "<WORKFLOW_RUN_ID>" })
   * ```
   *
   * @param workflowRunId run id of the workflow to delete
   * @returns true if workflow is succesfully deleted. Otherwise throws QStashError
   */
  public async cancel({ workflowRunId }: { workflowRunId: string }) {
    return await makeCancelRequest(this.client.http, workflowRunId);
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
}
