"use client";

import { useRealtime } from "@upstash/realtime/client";
import { useState, useCallback, useEffect, useRef } from "react";
import type { RealtimeEvents } from "@/lib/realtime";

interface WorkflowStep {
  stepName: string;
  status: "running" | "completed" | "failed";
  timestamp: number;
  error?: string;
  result?: unknown;
}

interface WaitingState {
  eventId: string;
  message: string;
  timestamp: number;
}

interface UseWorkflowWithRealtimeProps {
  workflowType: "basic" | "human-in-loop";
}

export function useWorkflowWithRealtime({ workflowType }: UseWorkflowWithRealtimeProps) {
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [waitingState, setWaitingState] = useState<WaitingState | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [runStatus, setRunStatus] = useState<null | { status: "running" | "success" | "failed"; startedAt?: number; finishedAt?: number; error?: string }>(null);
  const resolvedEventIdsRef = useRef<Set<string>>(new Set());

  // On mount, read query params and auto-connect if present
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const paramName = workflowType === "basic" ? "basicRunId" : "humanRunId";
    const id = url.searchParams.get(paramName);
    if (id && !workflowRunId) {
      setWorkflowRunId(id);
      setConnectionStatus("connecting");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime<RealtimeEvents>({
    enabled: !!workflowRunId,
    channels: workflowRunId ? [workflowRunId] : [],
    event: "workflow.update",
    history: true,
    onData(data) {
      setConnectionStatus("connected");
      if (data.type === "runStart") {
        setRunStatus({ status: "running", startedAt: data.timestamp });
      } else if (data.type === "runFinish") {
        setRunStatus({
          status: data.status,
          finishedAt: data.timestamp,
          error: data.error,
        });
      } else if (data.type === "inputResolved") {
        // Clear waiting state and ignore any prior waitingForInput from history
        resolvedEventIdsRef.current.add(data.eventId);
        setWaitingState((prev) => {
          if (prev && prev.eventId === data.eventId) {
            return null;
          }
          return prev;
        });
      } else if (data.type === "stepStart") {
        setSteps((prev) => [
          ...prev,
          {
            stepName: data.stepName,
            status: "running",
            timestamp: data.timestamp,
          },
        ]);
      } else if (data.type === "stepFinish") {
        setSteps((prev) =>
          prev.map((step) =>
            step.stepName === data.stepName
              ? { ...step, status: "completed", result: data.result }
              : step
          )
        );
      } else if (data.type === "stepFail") {
        setSteps((prev) =>
          prev.map((step) =>
            step.stepName === data.stepName
              ? { ...step, status: "failed", error: data.error }
              : step
          )
        );
      } else if (data.type === "waitingForInput") {
        // Ignore if already resolved (from history or live)
        if (resolvedEventIdsRef.current.has(data.eventId)) {
          return;
        }
        setWaitingState({
          eventId: data.eventId,
          message: data.message,
          timestamp: data.timestamp,
        });
      }
    },
  });

  const trigger = useCallback(async () => {
    setIsTriggering(true);
    setSteps([]);
    setWaitingState(null);
    setRunStatus(null);

    try {
      const response = await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowType }),
      });

      if (!response.ok) {
        throw new Error("Failed to trigger workflow");
      }

      const data = await response.json();
      const id = data.workflowRunId as string;
      setWorkflowRunId(id);
      // Write to query params
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const paramName = workflowType === "basic" ? "basicRunId" : "humanRunId";
        url.searchParams.set(paramName, id);
        window.history.replaceState({}, "", url.toString());
      }
    } catch (error) {
      console.error("Error triggering workflow:", error);
    } finally {
      setIsTriggering(false);
    }
  }, [workflowType]);

  const reset = useCallback(() => {
    // Clear URL param
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const paramName = workflowType === "basic" ? "basicRunId" : "humanRunId";
      url.searchParams.delete(paramName);
      window.history.replaceState({}, "", url.toString());
    }
    // Clear local state
    setWorkflowRunId(null);
    setSteps([]);
    setWaitingState(null);
    setRunStatus(null);
    setConnectionStatus("disconnected");
  }, [workflowType]);

  const continueWorkflow = useCallback(
    async (data: { approved: boolean }) => {
      if (!waitingState) {
        throw new Error("No workflow waiting for input");
      }

      try {
        const response = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: waitingState.eventId,
            eventData: data,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to notify workflow");
        }

        setWaitingState(null);
      } catch (error) {
        console.error("Error continuing workflow:", error);
        throw error;
      }
    },
    [waitingState]
  );

  const Component = () => (
    <div className="space-y-4 p-6 bg-zinc-800 text-zinc-200 rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">
          Workflow Monitor
          {workflowRunId && (
            <span className="text-sm font-normal ml-2 text-zinc-400">
              ({workflowRunId.slice(0, 8)}...)
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          <div
            className={`w-2 h-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "connecting"
                ? "bg-yellow-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-sm text-zinc-400 capitalize">
            {connectionStatus}
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors cursor-pointer"
            title="Clear state and URL"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Run status */}
      {runStatus && connectionStatus !== "connecting" && (
        <div className={`p-3 rounded border ${
          runStatus.status === "running"
            ? "bg-blue-900/20 border-blue-500"
            : runStatus.status === "success"
            ? "bg-green-900/20 border-green-500"
            : "bg-red-900/20 border-red-500"
        }`}>
          <div className="text-sm text-zinc-200">
            Run status: <strong className="capitalize text-zinc-100">{runStatus.status}</strong>
            {runStatus.error && (
              <span className="ml-2 text-red-400">({runStatus.error})</span>
            )}
          </div>
        </div>
      )}

      {steps.length === 0 && !workflowRunId && (
        <p className="text-zinc-400 text-center py-8">
          No workflow running. Click &quot;Trigger Workflow&quot; to start.
        </p>
      )}

      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step, index) => (
            <div
              key={`${step.stepName}-${index}`}
              className={`p-4 rounded-md border-l-4 ${
                step.status === "running"
                  ? "bg-blue-900/20 border-blue-500"
                  : step.status === "completed"
                  ? "bg-green-900/20 border-green-500"
                  : "bg-red-900/20 border-red-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-zinc-100">{step.stepName}</div>
                <div className="flex items-center gap-2">
                  {step.status === "running" && (
                    <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                  )}
                  <span
                    className={`text-sm px-2 py-1 rounded ${
                      step.status === "running"
                        ? "bg-blue-900/40 text-blue-200"
                        : step.status === "completed"
                        ? "bg-green-900/40 text-green-200"
                        : "bg-red-900/40 text-red-200"
                    }`}
                  >
                    {step.status}
                  </span>
                </div>
              </div>
              {step.error && (
                <div className="mt-2 text-sm text-red-400">{step.error}</div>
              )}
              {Boolean(step.result) && (
                <div className="mt-2 text-sm text-zinc-300">
                  Result: {JSON.stringify(step.result as Record<string, unknown>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {waitingState && (
        <div className="p-4 bg-yellow-900/20 border-l-4 border-yellow-500 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
            <span className="font-medium text-zinc-100">Waiting for Input</span>
          </div>
          <p className="text-sm text-zinc-300 mb-3">{waitingState.message}</p>
          <button
            onClick={() => continueWorkflow({ approved: true })}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors mr-2 cursor-pointer"
          >
            Approve
          </button>
          <button
            onClick={() => continueWorkflow({ approved: false })}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors cursor-pointer"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );

  return {
    Component,
    trigger,
    reset,
    isTriggering,
    workflowRunId,
    steps,
    waitingState,
    continueWorkflow,
    runStatus,
  };
}
