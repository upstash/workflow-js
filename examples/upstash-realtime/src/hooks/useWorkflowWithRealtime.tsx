"use client";

import { useRealtime } from "@/lib/realtime-client";
import { useState, useCallback } from "react";

interface WorkflowStep {
  stepName: string;
  result?: unknown;
}

interface WaitingState {
  eventId: string;
  message: string;
}

export function useWorkflowWithRealtime({ workflowType }: { workflowType: "basic" | "human-in-loop" }) {
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [waitingState, setWaitingState] = useState<WaitingState | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isRunFinished, setIsRunFinished] = useState(false);

  useRealtime({
    enabled: !!workflowRunId,
    channels: workflowRunId ? [workflowRunId] : [],
    events: [
      "workflow.stepFinish",
      "workflow.runFinish",
      "workflow.waitingForInput",
      "workflow.inputResolved",
    ],
    onData({ event, data }) {
      if (event === "workflow.stepFinish") {
        setSteps((prev) => [
          ...prev,
          {
            stepName: data.stepName,
            result: data.result,
          },
        ]);
      } else if (event === "workflow.runFinish") {
        setIsRunFinished(true);
      } else if (event === "workflow.inputResolved") {
        // Clear waiting state if it matches
        setWaitingState((prev) => 
          prev?.eventId === data.eventId ? null : prev
        );
      } else if (event === "workflow.waitingForInput") {
        setWaitingState({
          eventId: data.eventId,
          message: data.message,
        });
      }
    },
  });

  const trigger = useCallback(async () => {
    setIsTriggering(true);
    setSteps([]);
    setWaitingState(null);
    setIsRunFinished(false);

    const response = await fetch("/api/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowType }),
    });

    const data = await response.json();
    setWorkflowRunId(data.workflowRunId);
    setIsTriggering(false);
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
    setIsRunFinished(false)
    setWaitingState(null);
  }, [workflowType]);

  const continueWorkflow = useCallback(
    async (data: { approved: boolean }) => {
      if (!waitingState) {
        throw new Error("No workflow waiting for input");
      }

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

      // The waiting state will be cleared when we receive inputResolved event
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
      {isRunFinished && (
        <div className="p-3 rounded border bg-green-900/20 border-green-500">
          <div className="text-sm text-zinc-200">
            Run status: <strong className="capitalize text-zinc-100">finished</strong>
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
              className="p-4 rounded-md border-l-4 bg-green-900/20 border-green-500"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-zinc-100">{step.stepName}</div>
                <span className="text-sm px-2 py-1 rounded bg-green-900/40 text-green-200">
                  completed
                </span>
              </div>
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
    continueWorkflow,
    isTriggering,
    workflowRunId,
    steps,
    waitingState,
    isRunFinished,
  };
}