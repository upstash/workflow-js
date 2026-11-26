import { Client, QstashError } from "@upstash/qstash";
import { NotifyResponse, RawStep, Waiter } from "../types";
import { WorkflowLogger } from "../logger";
import { isInstanceOf } from "../error";

const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
// eslint-disable-next-line no-control-regex
const NOT_ALLOWED_IN_SEGMENT = /[\u0000-\u001F#/?\\\u007F]/;

/**
 * Checks that `id` can be used as a single URL path segment and returns it
 * unchanged.
 *
 * Ids are sent as they are, so an id has to stay in its own segment by
 * itself: `/`, `\`, `?`, `#`, control characters and surrounding whitespace
 * are not accepted, and neither are `.` and `..`.
 *
 * A value that is not a string, passed from plain JavaScript, is checked and
 * sent in its string form.
 */
export const toPathSegment = (id: string, label = "id"): string => {
  const segment = id === undefined || id === null ? "" : String(id);
  if (segment === "") {
    throw new QstashError(`${label} cannot be empty`);
  }
  if (DOT_SEGMENT.test(segment)) {
    throw new QstashError(`${label} cannot be "." or ".."`);
  }
  if (NOT_ALLOWED_IN_SEGMENT.test(segment) || segment !== segment.trim()) {
    throw new QstashError(
      `${label} cannot contain "/", "\\", "?", "#" or control characters, or start or end with whitespace`
    );
  }
  return segment;
};

export const makeNotifyRequest = async (
  requester: Client["http"],
  eventId: string,
  eventData?: unknown
): Promise<NotifyResponse[]> => {
  const result = (await requester.request({
    path: ["v2", "notify", toPathSegment(eventId, "Event id")],
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
    path: ["v2", "waiters", toPathSegment(eventId, "Event id")],
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
    path: ["v2", "workflows", "runs", toPathSegment(workflowRunId, "Workflow run id")],
    query: { cancel: true },
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
  debug?: WorkflowLogger
): Promise<
  { steps: RawStep[]; workflowRunEnded: false } | { steps: undefined; workflowRunEnded: true }
> => {
  try {
    const steps = (await requester.request({
      path: ["v2", "workflows", "runs", toPathSegment(workflowRunId, "Workflow run id")],
      parseResponseAsJson: true,
    })) as RawStep[];

    if (!messageId) {
      await debug?.log("INFO", "ENDPOINT_START", {
        message:
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
      await debug?.log("INFO", "ENDPOINT_START", {
        message:
          `Pulled ${steps.length} steps from QStash` +
          ` and filtered them to ${filteredSteps.length} using messageId.`,
      });
      return { steps: filteredSteps, workflowRunEnded: false };
    }
  } catch (error) {
    if (isInstanceOf(error, QstashError) && error.status === 404) {
      await debug?.log("WARN", "ENDPOINT_START", {
        message:
          "Couldn't fetch workflow run steps. This can happen if the workflow run succesfully ends before some callback is executed.",
        error: error,
      });
      return { steps: undefined, workflowRunEnded: true };
    } else {
      throw error;
    }
  }
};
