"use client";

import { useWorkflowWithRealtime } from "@/hooks/useWorkflowWithRealtime";

export default function Home() {
  const basicWorkflow = useWorkflowWithRealtime({ workflowType: "basic" });
  const humanInLoopWorkflow = useWorkflowWithRealtime({ workflowType: "human-in-loop" });

  return (
    <div className="min-h-screen p-8 pb-20 gap-16 sm:p-20 bg-zinc-900 text-zinc-200">
      <main className="max-w-7xl mx-auto">
        <div className="mb-12 text-zinc-400">
          <h1 className="text-4xl font-bold mb-4 text-zinc-100">
            Upstash Workflow + Upstash Realtime Demo
          </h1>
          <p>
            This demo showcases the integration of <a className="underline" href="https://upstash.com/docs/workflow/getstarted" target="_blank" rel="noopener noreferrer">Upstash Workflow</a> and <a className="underline" href="https://upstash.com/docs/realtime/overall/quickstart" target="_blank" rel="noopener noreferrer">Upstash Realtime</a> SDKs.
          </p>
          <p>
            Trigger workflows and see real-time updates of each step.
          </p>
          <p>
            Reload the page and reconnect to see the workflow status at any time.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Basic Workflow */}
          <div className="space-y-4">
            <div className="bg-zinc-800 p-6 rounded-lg shadow-md border border-zinc-700 h-[230px] flex flex-col justify-between">
              <div>
                <h2 className="text-zinc-100 text-2xl font-semibold mb-2">Basic Workflow</h2>
                <p className="text-zinc-300 mb-4">
                  A workflow with multiple steps that emit start, finish, and fail events.
                  Each step is wrapped in try/catch for error handling.
                </p>
              </div>
              <button
                onClick={basicWorkflow.trigger}
                disabled={basicWorkflow.isTriggering}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer transition-colors font-medium"
              >
                {basicWorkflow.isTriggering ? "Triggering..." : "Trigger Basic Workflow"}
              </button>
            </div>
            <basicWorkflow.Component />
          </div>

          {/* Human-in-the-Loop Workflow */}
          <div className="space-y-4">
            <div className="bg-zinc-800 p-6 rounded-lg shadow-md border border-zinc-700 h-[230px] flex flex-col justify-between">
              <div>
                <h2 className="text-zinc-100 text-2xl font-semibold mb-2">Human-in-the-Loop Workflow</h2>
                <p className="text-zinc-300 mb-4">
                  A workflow that pauses and waits for human approval using{" "}
                  <code className="bg-zinc-900 px-1 py-0.5 rounded">context.waitForEvent</code>.
                  The frontend receives the eventId and can notify the workflow to continue.
                </p>
              </div>
              <button
                onClick={humanInLoopWorkflow.trigger}
                disabled={humanInLoopWorkflow.isTriggering}
                className="w-full px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium cursor-pointer"
              >
                {humanInLoopWorkflow.isTriggering 
                  ? "Triggering..." 
                  : "Trigger Human-in-Loop Workflow"}
              </button>
            </div>
            <humanInLoopWorkflow.Component />
          </div>
        </div>
      </main>
    </div>
  );
}
