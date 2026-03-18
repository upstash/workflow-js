// ── Filter Utility Types ──────────────────────────────────────

import { WorkflowRunLog } from "./types";

type RequireAtLeastOne<T> = { [K in keyof T]-?: Required<Pick<T, K>> }[keyof T];

type NeverKeys<T> = { [K in keyof T]?: never };

/** Three-branch exclusive union: exactly one of A, B, or C. */
type Exclusive3<A, B, C> =
  | (A & NeverKeys<B> & NeverKeys<C>)
  | (B & NeverKeys<A> & NeverKeys<C>)
  | (C & NeverKeys<A> & NeverKeys<B>);

// ── Filter Field Groups ───────────────────────────────────────

/** Shared filter fields accepted by every qstash & workflow endpoint. */
type UniversalFilterFields = {
  fromDate?: Date | number;
  toDate?: Date | number;
  callerIp?: string;
  label?: string;
  flowControlKey?: string;
};

/** Workflow-specific filter fields for DLQ and bulk endpoints. */
type WorkflowFilterFields = {
  workflowUrl?: string;
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

type CancelFilterFields = UniversalFilterFields &
  Pick<WorkflowFilterFields, "workflowUrl"> & {
    workflowUrlExactMatch?: boolean;
  };

// ── Composed Endpoint Filter Types ────────────────────────────

/**
 * DLQ bulk actions (resume, restart, delete) support three modes:
 * - By dlqIds (no cursor)
 * - By filter fields (with optional cursor)
 * - All (with optional cursor)
 */
export type WorkflowDLQActionFilters = Exclusive3<
  { dlqIds: string | string[] },
  { filter: RequireAtLeastOne<DLQActionFilterFields>; cursor?: string },
  { all: true; cursor?: string }
>;

export type WorkflowDLQListFilters = UniversalFilterFields & WorkflowFilterFields;

/**
 * We don't accept a single workflowRunId or workflowCreatedAt because there
 * could only be one running workflow with a single wfrid at the same time.
 * So using these do not make sense.
 *
 * Also failureFunctionState is not available.
 * Cancel does not support cursor.
 */
export type WorkflowRunCancelFilters = Exclusive3<
  { workflowRunIds: string[] },
  { filter: RequireAtLeastOne<CancelFilterFields> },
  { all: true }
>;

export type WorkflowLogsListFilters = UniversalFilterFields &
  Pick<WorkflowFilterFields, "workflowUrl" | "workflowRunId"> &
  WorkflowLogsFilterFields;
