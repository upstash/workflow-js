import { serve } from "@upstash/workflow/nextjs";
import { realtime } from "@/lib/realtime";

type WorkflowPayload = {
  userId: string;
  action: string;
};

export const { POST } = serve<WorkflowPayload>(async (context) => {
  const { userId, action } = context.requestPayload;
  const workflowRunId = context.workflowRunId;

  // Create a channel based on the workflow run ID
  const channel = realtime.channel(workflowRunId);

  // Step 1: Data Validation
  await context.run("validate-data", async () => {
    // Your validation logic
    if (!userId || !action) {
      throw new Error("Missing required fields");
    }

    const result = { valid: true, userId, action };

    // sleep 500 ms
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Emit step completion
    await channel.emit("workflow.stepFinish", {
      stepName: "validate-data",
      result,
    });

    return result;
  });

  // Step 2: Data Processing
  await context.run("process-data", async () => {
    // Your processing logic
    const result = {
      processed: true,
      userId,
      action,
      timestamp: Date.now(),
    };

    // sleep 500 ms
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Emit step completion
    await channel.emit("workflow.stepFinish", {
      stepName: "process-data",
      result,
    });

    return result;
  });

  // Additional steps follow the same pattern...

  // Emit run completion
  await context.run("run-finish", () => channel.emit("workflow.runFinish", {}) );

  return { success: true, workflowRunId };
});