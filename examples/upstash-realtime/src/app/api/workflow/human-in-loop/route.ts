import { serve } from "@upstash/workflow/nextjs";
import { realtime } from "@/lib/realtime";

type WorkflowPayload = {
  userId: string;
  action: string;
};

export const { POST } = serve<WorkflowPayload>(async (context) => {
  const { userId, action } = context.requestPayload;
  const workflowRunId = context.workflowRunId;
  const channel = realtime.channel(workflowRunId);

  // Step 1: Initial Processing
  await context.run("initial-processing", async () => {
    // Your processing logic
    const result = {
      preprocessed: true,
      userId,
      action,
      requiresApproval: true,
    };

    // Emit step completion
    await channel.emit("workflow.stepFinish", {
      stepName: "initial-processing",
      result,
    });
    return result;
  });

  // Step 2: Wait for Human Approval
  const eventId = `approval-${workflowRunId}`;

  const [{ eventData, timeout }] = await Promise.all([
    // Wait for approval event
    context.waitForEvent<{ approved: boolean }>("wait-for-approval", eventId, { timeout: "5m" }),
    // Notify frontend that we're waiting
    context.run("notify-waiting", () =>
      channel.emit("workflow.waitingForInput", {
        eventId,
        message: `Waiting for approval to process action: ${action}`,
      })
    ),
  ]);

  // Handle timeout
  if (timeout) {
    return { success: false, reason: "timeout" };
  }

  // Notify that input was resolved
  await context.run("input-resolved", () =>
    channel.emit("workflow.inputResolved", {
      eventId,
    })
  );

  const status = eventData.approved ? "approved" : "rejected";

  // Step 3: Process based on approval
  await context.run(`process-${status}`, async () => {
    const result = {
      status,
      processedAt: Date.now(),
      action,
      userId,
    };

    // Emit step completion
    await channel.emit("workflow.stepFinish", {
      stepName: `process-${status}`,
      result,
    });
    return result;
  });

  // Step 4: Finalize (only if approved)
  if (eventData.approved) {
    // Additional steps...
  }

  // Emit completion
  await context.run("run-finish", () => channel.emit("workflow.runFinish", {}));

  return {
    success: true,
    approved: eventData.approved,
    workflowRunId,
  };
});