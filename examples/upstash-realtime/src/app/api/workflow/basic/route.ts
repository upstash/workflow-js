import { serve } from "@upstash/workflow/nextjs";
import { realtime } from "@/lib/realtime";
import { WorkflowAbort } from "@upstash/workflow";

type WorkflowPayload = {
  userId: string;
  action: string;
};

export const { POST } = serve<WorkflowPayload>(
  async (context) => {
    const { userId, action } = context.requestPayload;
    const workflowRunId = context.workflowRunId;

    const channel = realtime.channel(workflowRunId);

    // Run start
    await context.run("start-workflow", () =>
      channel.emit("workflow.update", {
        type: "runStart",
        workflowRunId,
        timestamp: Date.now(),
      })
    );

    // Step 1: Data Validation
    try {
      await context.run("validate-data", async () => {
        await channel.emit("workflow.update", {
          type: "stepStart",
          workflowRunId,
          stepName: "validate-data",
          timestamp: Date.now(),
        });

        // Simulate validation logic
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (!userId || !action) {
          throw new Error("Missing required fields");
        }

        const res = { valid: true, userId, action };
        await channel.emit("workflow.update", {
          type: "stepFinish",
          workflowRunId,
          stepName: "validate-data",
          timestamp: Date.now(),
          result: res,
        });
        return res;
      });
    } catch (error) {
      if (error instanceof WorkflowAbort) {
        throw error;
      }
      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "validate-data",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    // Step 2: Process Data
    try {
      await context.run("process-data", async () => {
        await channel.emit("workflow.update", {
          type: "stepStart",
          workflowRunId,
          stepName: "process-data",
          timestamp: Date.now(),
        });

        // Simulate data processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        const res = {
          processedAt: Date.now(),
          status: "processed",
          data: { userId, action, processed: true },
        };
        await channel.emit("workflow.update", {
          type: "stepFinish",
          workflowRunId,
          stepName: "process-data",
          timestamp: Date.now(),
          result: res,
        });
        return res;
      });
    } catch (error) {
      if (error instanceof WorkflowAbort) {
        throw error;
      }
      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "process-data",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    // Step 3: Save Results
    try {
      await context.run("save-results", async () => {
        await channel.emit("workflow.update", {
          type: "stepStart",
          workflowRunId,
          stepName: "save-results",
          timestamp: Date.now(),
        });

        // Simulate saving to database
        await new Promise((resolve) => setTimeout(resolve, 100));

        const res = {
          saved: true,
          timestamp: Date.now(),
        };
        await channel.emit("workflow.update", {
          type: "stepFinish",
          workflowRunId,
          stepName: "save-results",
          timestamp: Date.now(),
          result: res,
        });
        return res;
      });
    } catch (error) {
      if (error instanceof WorkflowAbort) {
        throw error;
      }
      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "save-results",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    // Run finish (success)
    await channel.emit("workflow.update", {
      type: "runFinish",
      workflowRunId,
      timestamp: Date.now(),
      status: "success",
    });
    return { success: true, workflowRunId };
  },
  {
    failureFunction: async ({ context }) => {
      const workflowRunId = context.workflowRunId;
      const channel = realtime.channel(workflowRunId);

      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "workflow",
        timestamp: Date.now(),
        error: "Workflow execution failed",
      });
      await channel.emit("workflow.update", {
        type: "runFinish",
        workflowRunId,
        timestamp: Date.now(),
        status: "failed",
        error: "Workflow execution failed",
      });
    },
  }
);
