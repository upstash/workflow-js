import { HTTPMethods } from "@upstash/qstash"
import { RawStep, StepType } from "../types"

type LogStepBase = {
  stepId: number
  stepName: string
  stepType: StepType
  callType: RawStep["callType"]
  messageId: string
  out: unknown
  concurrent: number
  state: "STEP_PROGRESS" | "STEP_SUCCESS" | "STEP_RETRY" | "STEP_FAILED"
  createdAt: number
}

type CallUrlGroup = {
  callUrl: string
  callMethod: HTTPMethods
  callHeaders: Record<string, string[]>
}

type CallResponseStatusGroup = {
  callResponseStatus: number
  callResponseBody: unknown
  callResponseHeaders: Record<string, string[]>
} & CallUrlGroup

type InvokedWorkflowGroup = {
  invokedWorkflowRunId: string
  invokedWorkflowUrl: string
  invokedWorkflowCreatedAt: number
  invokedWorkflowRunBody: unknown
  invokedWorkflowRunHeaders: Record<string, string[]>
}

type WaitEventGroup = {
  waitEventId: string
  waitTimeoutDuration: string
  waitTimeoutDeadline: number
  waitTimeout: boolean
}

export type LogStep = LogStepBase & (CallUrlGroup | CallResponseStatusGroup | InvokedWorkflowGroup | WaitEventGroup)

type LogGroupedStep = {
  steps: [LogStep],
  type: "sequential"
} | {
  steps: LogStep[],
  type: "parallel"
} | {
  steps: { messageId: string, state: "STEP_PROGRESS" | "STEP_RETRY" | "STEP_FAILED" }[]
  type: "next"
}

export type WorkflowRunLogs = {
  workflowRunId: string
  workflowUrl: string
  workflowState: "RUN_STARTED" | "RUN_SUCCESS" | "RUN_FAILED"
  workflowRunCreatedAt: number,
  workflowRunCompletedAt: number,
  steps: LogGroupedStep[]
}

export type WorkflowRunResponse = {
  cursor: string,
  runs: WorkflowRunLogs[]
}