import { Client } from "@upstash/qstash";
import { NotifyResponse, RawStep, Waiter } from "../types";
import { WorkflowLogger } from "../logger";
import { WorkflowError } from "../error";

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

export const getSteps = async (
  requester: Client["http"],
  workflowRunId: string,
  messageId?: string,
  debug?: WorkflowLogger
): Promise<RawStep[]> => {
  try {
    const steps = (await requester.request({
      path: ["v2", "workflows", "runs", workflowRunId],
      parseResponseAsJson: true,
    })) as RawStep[];

    if (!messageId) {
      await debug?.log("INFO", "ENDPOINT_START", {
        message:
          `Pulled ${steps.length} steps from QStash` +
          `and returned them without filtering with messageId.`,
      });
      return steps;
    } else {
      const index = steps.findIndex((item) => item.messageId === messageId);

      if (index === -1) {
        // targetMessageId not found, return an empty array or handle it as needed
        return [];
      }

      const filteredSteps = steps.slice(0, index + 1);
      await debug?.log("INFO", "ENDPOINT_START", {
        message:
          `Pulled ${steps.length} steps from QStash` +
          `and filtered them to ${filteredSteps.length} using messageId.`,
      });
      return filteredSteps;
    }
  } catch (error) {
    await debug?.log("ERROR", "ERROR", {
      message: "failed while fetching steps.",
      error: error,
    });
    throw new WorkflowError(`Failed while pulling steps. ${error}`);
  }
};
