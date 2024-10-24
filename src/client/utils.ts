import { Client } from "@upstash/qstash";
import { NotifyResponse, RawStep, Waiter } from "../types";
import { WorkflowLogger } from "../logger";

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

export const makeCancelRequest = async (requester: Client["http"], workflowRunId: string) => {
  const result = (await requester.request({
    path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=true`],
    method: "DELETE",
    parseResponseAsJson: false,
  })) as { error: string } | undefined;
  return result ?? true;
};

export const getSteps = async (
  requester: Client["http"],
  workflowRunId: string,
  debug?: WorkflowLogger
): Promise<RawStep[]> => {
  await debug?.log("INFO", "ENDPOINT_START", "Pulling steps from QStash.");
  return (await requester.request({
    path: ["v2", "workflows", "runs", workflowRunId],
    parseResponseAsJson: true,
  })) as RawStep[];
};
