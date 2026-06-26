// ── Filter Utility Types ──────────────────────────────────────

import { WorkflowRunLog } from "./types";

type RequireAtLeastOne<T> = { [K in keyof T]-?: Required<Pick<T, K>> }[keyof T];

// ── Filter Field Groups ───────────────────────────────────────

/**
 * Shared filter fields accepted by every qstash & workflow endpoint.
 *
 * Most fields support multi-value filtering: pass an array to match a record
 * whose value equals any of the given values (OR semantics). Separate filters
 * are combined with AND semantics.
 */
type UniversalFilterFields = {
  fromDate?: Date | number;
  toDate?: Date | number;
  /** Filter by the IP address of the publisher. Supports multiple values. */
  callerIp?: string | string[];
  /**
   * Filter by label.
   *
   * Pass an array to match runs that have any of the given labels (OR semantics).
   * For example, with runs labelled `[label_1, label_2]` and `[label_2, label_3]`,
   * filtering by `[label_1, label_2]` returns both.
   */
  label?: string | string[];
  /** Filter by Flow Control Key. Supports multiple values. */
  flowControlKey?: string | string[];
};

/** Workflow-specific filter fields for DLQ and bulk endpoints. */
type WorkflowFilterFields = {
  /** Filter by workflow URL. Supports multiple values. */
  workflowUrl?: string | string[];
  workflowRunId?: string;
  workflowCreatedAt?: number;
  failureFunctionState?: string;
};

type WorkflowLogsFilterFields = {
  state?: WorkflowRunLog["workflowState"];
  messageId?: string;
};

// ── Composed Filter Field Types ───────────────────────────────

type DLQActionFilterFields = UniversalFilterFields & WorkflowFilterFields;

/** Cancel filter: exact URL match. Cannot combine with `workflowUrlStartingWith`. */
type CancelFilterWithExactUrl = UniversalFilterFields & {
  /** Filter by exact workflow URL. Supports multiple values. */
  workflowUrl: string | string[];
  workflowUrlStartingWith?: never;
};

/** Cancel filter: URL prefix match. Cannot combine with `workflowUrl`. */
type CancelFilterWithPrefixUrl = UniversalFilterFields & {
  /** Filter by workflow URL prefix. Supports multiple values. */
  workflowUrlStartingWith: string | string[];
  workflowUrl?: never;
};

/** Cancel filter: no URL. Requires at least one other filter field. */
type CancelFilterWithoutUrl = RequireAtLeastOne<UniversalFilterFields> & {
  workflowUrl?: never;
  workflowUrlStartingWith?: never;
};

type CancelFilter = CancelFilterWithExactUrl | CancelFilterWithPrefixUrl | CancelFilterWithoutUrl;

// ── Composed Endpoint Filter Types ────────────────────────────

type WorkflowDLQBulkCount = {
  cursor?: string;
  /**
   * Maximum number of messages to process per call.
   *
   * @default 100
   */
  count?: number;
};

/**
 * DLQ bulk actions (resume, restart, delete) support three modes:
 * - By dlqIds (no cursor)
 * - By filter fields (with optional cursor and count)
 * - All (with optional cursor and count)
 */
export type WorkflowDLQActionFilters =
  | { dlqIds: string | string[]; filter?: never; all?: never; count?: never; cursor?: never }
  | ({
      filter: RequireAtLeastOne<DLQActionFilterFields>;
      dlqIds?: never;
      all?: never;
    } & WorkflowDLQBulkCount)
  | ({
      all: true;
      dlqIds?: never;
      filter?: never;
    } & WorkflowDLQBulkCount);

export type WorkflowDLQListFilters = UniversalFilterFields &
  WorkflowFilterFields & {
    /** @deprecated Use `workflowUrl` instead. */
    url?: string;
    /** @deprecated No longer supported in the new API. */
    responseStatus?: number;
  };

type WorkflowCancelCount = {
  /**
   * Maximum number of workflow runs to cancel per call.
   *
   * @default 100
   */
  count?: number;
};

/**
 * We don't accept a single workflowRunId or workflowCreatedAt because there
 * could only be one running workflow with a single wfrid at the same time.
 * So using these do not make sense.
 *
 * Also failureFunctionState is not available.
 * Cancel does not support cursor.
 */
export type WorkflowRunCancelFilters =
  | { workflowRunIds: string[]; filter?: never; all?: never; count?: never }
  | ({
      filter: CancelFilter;
      workflowRunIds?: never;
      all?: never;
    } & WorkflowCancelCount)
  | ({
      all: true;
      workflowRunIds?: never;
      filter?: never;
    } & WorkflowCancelCount);

export type WorkflowLogsListFilters = UniversalFilterFields &
  Pick<WorkflowFilterFields, "workflowUrl" | "workflowRunId" | "workflowCreatedAt"> &
  WorkflowLogsFilterFields;
