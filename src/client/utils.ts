import { Client, QstashError } from "@upstash/qstash";
import { NotifyResponse, RawStep, Waiter } from "../types";
import { isInstanceOf } from "../error";
import { DispatchDebug } from "../middleware/types";
import { WorkflowDLQActionFilters, WorkflowRunCancelFilters } from "./filter-types";

/**
 * Makes a request to notify waiting workflows.
 *
 * @param requester QStash HTTP requester
 * @param eventId event ID to notify
 * @param eventData optional event data to send
 * @param workflowRunId optional workflow run ID for lookback support
 */
export const makeNotifyRequest = async (
  requester: Client["http"],
  eventId: string,
  eventData?: unknown,
  workflowRunId?: string
): Promise<NotifyResponse[]> => {
  const path = workflowRunId ? ["v2", "notify", workflowRunId, eventId] : ["v2", "notify", eventId];

  const result = (await requester.request({
    path,
    method: "POST",
    body: typeof eventData === "string" ? eventData : JSON.stringify(eventData),
  })) as NotifyResponse[];

  return result;
};

/**
 * Gets waiters for a specific event.
 *
 * @param requester QStash HTTP requester
 * @param eventId event ID to check waiters for
 */
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
  dispatchDebug?: DispatchDebug
): Promise<
  { steps: RawStep[]; workflowRunEnded: false } | { steps: undefined; workflowRunEnded: true }
> => {
  try {
    const steps = (await requester.request({
      path: ["v2", "workflows", "runs", workflowRunId],
      parseResponseAsJson: true,
    })) as RawStep[];

    if (steps.length === 1) {
      /**
       * If the user call /trigger and passes a large body, lazyFetch will be activated
       * and getSteps will be called.
       *
       * In this case, there will be only the one step in the workflow run, but messageId
       * will be diffent from the one in the headers.
       */
      return {
        steps,
        workflowRunEnded: false,
      };
    }

    if (!messageId) {
      await dispatchDebug?.("onInfo", {
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
      await dispatchDebug?.("onInfo", {
        info:
          `Pulled ${steps.length} steps from QStash` +
          ` and filtered them to ${filteredSteps.length} using messageId.`,
      });
      return { steps: filteredSteps, workflowRunEnded: false };
    }
  } catch (error) {
    if (isInstanceOf(error, QstashError) && error.status === 404) {
      await dispatchDebug?.("onWarning", {
        warning:
          "Couldn't fetch workflow run steps. This can happen if the workflow run succesfully ends before some callback is executed.",
      });
      return { steps: undefined, workflowRunEnded: true };
    } else {
      throw error;
    }
  }
};

/**
 * Normalizes a response cursor: converts empty string to `undefined`
 * so that callers can reliably use `cursor` as a boolean presence check.
 */
export function normalizeCursor<T>(response: T): T {
  const cursor = (response as { cursor?: string }).cursor;
  return { ...response, cursor: cursor || undefined };
}

const DEFAULT_BULK_COUNT = 100;

/**
 * Builds query parameters for bulk actions (DLQ resume/restart/delete and workflow cancel).
 *
 * Validates that ID arrays are not empty and applies a default `count` of 100
 * for filter-based and `{ all: true }` operations.
 *
 * @example DLQ action with dlqIds
 * ```ts
 * buildBulkActionQueryParameters({ dlqIds: ["dlq_1", "dlq_2"] })
 * // => { dlqIds: ["dlq_1", "dlq_2"] }
 * ```
 *
 * @example DLQ action targeting all with custom count
 * ```ts
 * buildBulkActionQueryParameters({ all: true, count: 50 })
 * // => { all: true, count: 50 }
 * ```
 *
 * @example Cancel with workflowRunIds
 * ```ts
 * buildBulkActionQueryParameters({ workflowRunIds: ["wfr_1", "wfr_2"] })
 * // => { workflowRunIds: ["wfr_1", "wfr_2"] }
 * ```
 *
 * @example Cancel targeting all (uses default count of 100)
 * ```ts
 * buildBulkActionQueryParameters({ all: true })
 * // => { all: true, count: 100 }
 * ```
 *
 * @throws {QstashError} If an empty `dlqIds` or `workflowRunIds` array is provided
 */
export function buildBulkActionQueryParameters(
  request: WorkflowDLQActionFilters | WorkflowRunCancelFilters,
  options?: { translateWorkflowUrl?: boolean }
) {
  const cursor = "cursor" in request ? request.cursor : undefined;

  if ("all" in request) {
    return { count: request.count ?? DEFAULT_BULK_COUNT, cursor };
  }

  if ("dlqIds" in request) {
    const ids = request.dlqIds;
    if (Array.isArray(ids) && ids.length === 0) {
      throw new QstashError(
        "Empty dlqIds array provided. If you intend to target all DLQ messages, use { all: true } explicitly."
      );
    }
    return { dlqIds: ids, cursor };
  }

  if ("workflowRunIds" in request && request.workflowRunIds) {
    if (request.workflowRunIds.length === 0) {
      throw new QstashError(
        "Empty workflowRunIds array provided. If you intend to target all workflow runs, use { all: true } explicitly."
      );
    }
    return { workflowRunIds: request.workflowRunIds };
  }

  // Filter branch
  const filter = request.filter as Record<string, unknown> | undefined;

  if (!filter) {
    throw new QstashError(
      "No filter provided. Use { filter: { ... } } with at least one filter field, or { all: true }."
    );
  }

  // When translateWorkflowUrl is set (cancel filters), translate
  // workflowUrl/workflowUrlStartingWith into the server's query params:
  // - workflowUrl → workflowUrl + workflowUrlExactMatch=true (exact match)
  // - workflowUrlStartingWith → workflowUrl (prefix match, server default)
  if (options?.translateWorkflowUrl) {
    const { workflowUrlStartingWith, workflowUrl, ...rest } = filter;

    if (workflowUrlStartingWith && workflowUrl) {
      throw new QstashError(
        "workflowUrl and workflowUrlStartingWith are mutually exclusive. " +
          "Use workflowUrl for exact match or workflowUrlStartingWith for prefix match."
      );
    }

    const urlParams: Record<string, string | boolean> = {};
    if (workflowUrlStartingWith) {
      urlParams.workflowUrl = workflowUrlStartingWith as string;
    } else if (workflowUrl) {
      urlParams.workflowUrl = workflowUrl as string;
      urlParams.workflowUrlExactMatch = true;
    }

    return {
      ...rest,
      ...urlParams,
      count: request.count ?? DEFAULT_BULK_COUNT,
      cursor,
    };
  }

  return {
    ...filter,
    count: request.count ?? DEFAULT_BULK_COUNT,
    cursor,
  };
}
