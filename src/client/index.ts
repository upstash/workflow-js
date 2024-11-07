import { NotifyResponse, Waiter } from "../types";
import { Client as QStashClient } from "@upstash/qstash";
import { makeGetWaitersRequest, makeNotifyRequest } from "./utils";
import { getWorkflowRunId } from "../utils";
import { triggerFirstInvocation } from "../workflow-requests";
import { WorkflowContext } from "../context";
import { DEFAULT_RETRIES } from "../constants";

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
   * Trigger new workflow run and returns the workflow run id
   * 
   * @param url URL of the workflow
   * @param body body to start the workflow with
   * @param headers headers to use in the request
   * @param workflowRunId optional workflow run id to use. mind that
   *   you should pass different workflow run ids everytime.
   * @param retries retry to use in the initial request. in the rest of
   *   the workflow, `retries` option of the `serve` will be used.
   * @returns workflow run id
   */
  public async trigger({
    url,
    body,
    headers,
    workflowRunId,
    retries
  }: {
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
    workflowRunId?: string,
    retries?: number
  }): Promise<{workflowRunId: string}> {
    const finalWorkflowRunId = getWorkflowRunId(workflowRunId)
    const context = new WorkflowContext({
      qstashClient: this.client,
      // @ts-expect-error headers type mismatch
      headers: new Headers(headers ?? {}),
      initialPayload: body,
      steps: [],
      url,
      workflowRunId: finalWorkflowRunId,
    })
    const result = await triggerFirstInvocation(context, retries ?? DEFAULT_RETRIES)
    if (result.isOk()) {
      return { workflowRunId: finalWorkflowRunId }
    } else {
      throw result.error
    }
  }
}
