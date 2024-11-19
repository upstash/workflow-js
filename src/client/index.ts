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
   * Returns true if workflow is canceled succesfully. Otherwise, throws error.
   *
   * There are multiple ways you can cancel workflows:
   * - pass one or more workflow run ids to cancel them
   * - pass a workflow url to cancel all runs starting with this url
   * - cancel all pending or active workflow runs
   *
   * ### Cancel a set of workflow runs
   *
   * ```ts
   * // cancel a single workflow
   * await client.cancel({ ids: "<WORKFLOW_RUN_ID>" })
   *
   * // cancel a set of workflow runs
   * await client.cancel({ ids: [
   *   "<WORKFLOW_RUN_ID_1>",
   *   "<WORKFLOW_RUN_ID_2>",
   * ]})
   * ```
   *
   * ### Cancel workflows starting with a url
   *
   * If you have an endpoint called `https://your-endpoint.com` and you
   * want to cancel all workflow runs on it, you can use `urlStartingWith`.
   *
   * Note that this will cancel workflows in all endpoints under
   * `https://your-endpoint.com`.
   *
   * ```ts
   * await client.cancel({ urlStartingWith: "https://your-endpoint.com" })
   * ```
   *
   * ### Cancel *all* workflows
   *
   * To cancel all pending and currently running workflows, you can
   * do it like this:
   *
   * ```ts
   * await client.cancel({ all: true })
   * ```
   *
   * @param ids run id of the workflow to delete
   * @param urlStartingWith cancel workflows starting with this url. Will be ignored
   *   if `ids` parameter is set.
   * @param all set to true in order to cancel all workflows. Will be ignored
   *   if `ids` or `urlStartingWith` parameters are set.
   * @returns true if workflow is succesfully deleted. Otherwise throws QStashError
   */
  public async cancel({
    ids,
    urlStartingWith,
    all,
  }: {
    ids?: string | string[];
    urlStartingWith?: string;
    all?: true;
  }) {
    let body: string;
    if (ids) {
      const runIdArray = typeof ids === "string" ? [ids] : ids;

      body = JSON.stringify({ workflowRunIds: runIdArray });
    } else if (urlStartingWith) {
      body = JSON.stringify({ workflowUrl: urlStartingWith });
    } else if (all) {
      body = "{}";
    } else {
      throw new TypeError("The `cancel` method cannot be called without any options.");
    }

    const result = await this.client.http.request<{ cancelled: number }>({
      path: ["v2", "workflows", "runs"],
      method: "DELETE",
      body,
      headers: {
        "Content-Type": "application/json",
      },
    });

    return result;
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
   * ```ts
   * const { workflowRunId } = await client.trigger({
   *   url: "https://workflow-endpoint.com",
   *   body: "hello there!",         // Optional body
   *   headers: { ... },             // Optional headers
   *   workflowRunId: "my-workflow", // Optional workflow run ID
   *   retries: 3                    // Optional retries for the initial request
   * });
   *
   * console.log(workflowRunId)
   * // wfr_my-workflow
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
   * @returns workflow run id
   */
  public async trigger({
    url,
    body,
    headers,
    workflowRunId,
    retries,
  }: {
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
    workflowRunId?: string;
    retries?: number;
  }): Promise<{ workflowRunId: string }> {
    const finalWorkflowRunId = getWorkflowRunId(workflowRunId);
    const context = new WorkflowContext({
      qstashClient: this.client,
      // @ts-expect-error headers type mismatch
      headers: new Headers(headers ?? {}),
      initialPayload: body,
      steps: [],
      url,
      workflowRunId: finalWorkflowRunId,
    });
    const result = await triggerFirstInvocation(context, retries ?? DEFAULT_RETRIES);
    if (result.isOk()) {
      return { workflowRunId: finalWorkflowRunId };
    } else {
      throw result.error;
    }
  }
}
