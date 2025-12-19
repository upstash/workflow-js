import { Client, QstashError } from "@upstash/qstash";
import { NotifyResponse, RawStep, Waiter } from "../types";
import { isInstanceOf } from "../error";
import { WorkflowMiddleware } from "../middleware";
import { runMiddlewares } from "../middleware/middleware";

export const makeNotifyRequest = async (
  requester: Client["http"],
  eventId: string,
  eventData?: unknown
): Promise<NotifyResponse[]> => {
  const result = (await requester.request({
    path: ["v2", "notify", eventId],
    method: "POST",
    body: typeof eventData === "string" ? eventData : JSON.stringify(eventData),
  })) as NotifyResponse[];

  return result;
};

export const makeGetWaitersRequest = async (
  requester: Client["http"],
  eventId: string
): Promise<Required<Waiter>[]> => {
  const result = (await requester.request({
    path: ["v2", "waiters", eventId],
    method: "GET",
  })) as Required<Waiter>[];
  return result;
};

/**
 * Returns true if workflow is canceled succesfully. Otherwise, throws error.
 *
 * @param requester client.http
 * @param workflowRunId workflow to cancel
 * @returns true if workflow is canceled
 */
export const makeCancelRequest = async (requester: Client["http"], workflowRunId: string) => {
  (await requester.request({
    path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=true`],
    method: "DELETE",
    parseResponseAsJson: false,
  })) as undefined;
  return true;
};

/**
 * fetches steps from QStash for lazy fetch feature.
 *
 * @param requester to call QStash
 * @param workflowRunId id of the workflow run
 * @param messageId message id being called. Only the steps until this messageId will be returned
 *    step with the provided messageId is included.
 * @param debug logger
 * @returns the steps if the run exists. otherwise returns workflowRunEnded: true.
 */
export const getSteps = async (
  requester: Client["http"],
  workflowRunId: string,
  messageId?: string,
  middlewares?: WorkflowMiddleware[]
): Promise<
  { steps: RawStep[]; workflowRunEnded: false } | { steps: undefined; workflowRunEnded: true }
> => {
  try {
    const steps = (await requester.request({
      path: ["v2", "workflows", "runs", workflowRunId],
      parseResponseAsJson: true,
    })) as RawStep[];

    if (!messageId) {
      await runMiddlewares(middlewares, "onInfo", {
        workflowRunId,
        info:
          `Pulled ${steps.length} steps from QStash` +
          `and returned them without filtering with messageId.`,
      });
      return { steps, workflowRunEnded: false };
    } else {
      const index = steps.findIndex((item) => item.messageId === messageId);

      if (index === -1) {
        // targetMessageId not found, return an empty array or handle it as needed
        return { steps: [], workflowRunEnded: false };
      }

      const filteredSteps = steps.slice(0, index + 1);
      await runMiddlewares(middlewares, "onInfo", {
        workflowRunId,
        info:
          `Pulled ${steps.length} steps from QStash` +
          ` and filtered them to ${filteredSteps.length} using messageId.`,
      });
      return { steps: filteredSteps, workflowRunEnded: false };
    }
  } catch (error) {
    if (isInstanceOf(error, QstashError) && error.status === 404) {
      await runMiddlewares(middlewares, "onWarning", {
        workflowRunId,
        warning:
          "Couldn't fetch workflow run steps. This can happen if the workflow run succesfully ends before some callback is executed.",
      });
      return { steps: undefined, workflowRunEnded: true };
    } else {
      throw error;
    }
  }
};
