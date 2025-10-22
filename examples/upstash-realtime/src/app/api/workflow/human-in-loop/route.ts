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
    await context.run("start-workflow", () => channel.emit("workflow.update", {
      type: "runStart",
      workflowRunId,
      timestamp: Date.now(),
    }));

    // Step 1: Initial Processing
    try {
      await context.run("initial-processing", async () => {
        await channel.emit("workflow.update", {
          type: "stepStart",
          workflowRunId,
          stepName: "initial-processing",
          timestamp: Date.now(),
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));
        const res = {
          preprocessed: true,
          userId,
          action,
          requiresApproval: true
        };
        await channel.emit("workflow.update", {
          type: "stepFinish",
          workflowRunId,
          stepName: "initial-processing",
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
        stepName: "initial-processing",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    // Step 2: Human in the Loop - Wait for approval
    const eventId = `approval-${workflowRunId}`;

    const [{ eventData, timeout }] = await Promise.all([
      context.waitForEvent<{ approved: boolean }>(
        "wait-for-approval",
        eventId,
        {
          timeout: "5m", // 5 minutes timeout
        }
      ),
      context.run("notify-waiting-for-approval", () => channel.emit("workflow.update", {
        type: "waitingForInput",
        workflowRunId,
        eventId,
        message: `Waiting for approval to process action: ${action}`,
        timestamp: Date.now(),
      })),
    ])

    if (timeout) {
      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "wait-for-approval",
        timestamp: Date.now(),
        error: "Approval timeout - no response received within 5 minutes",
      });
      return { success: false, reason: "timeout" };
    }
    // Mark input resolved to allow clients to ignore historical waitingForInput
    await channel.emit("workflow.update", {
      type: "inputResolved",
      workflowRunId,
      eventId,
      timestamp: Date.now(),
    });

    // Step 3: Process based on approval
    try {
      await context.run("process-approval", async () => {
        await channel.emit("workflow.update", {
          type: "stepStart",
          workflowRunId,
          stepName: "process-approval",
          timestamp: Date.now(),
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (eventData.approved) {
          const res = {
            status: "approved",
            processedAt: Date.now(),
            action,
            userId,
          };
          await channel.emit("workflow.update", {
            type: "stepFinish",
            workflowRunId,
            stepName: "process-approval",
            timestamp: Date.now(),
            result: res,
          });
          return res;
        } else {
          const res = {
            status: "rejected",
            rejectedAt: Date.now(),
            action,
            userId,
          };
          await channel.emit("workflow.update", {
            type: "stepFinish",
            workflowRunId,
            stepName: "process-approval",
            timestamp: Date.now(),
            result: res,
          });
          return res;
        }
      });

      // Step 4: Finalize (only if approved)
      if (eventData.approved) {
        try {
          await context.run("finalize", async () => {
            await channel.emit("workflow.update", {
              type: "stepStart",
              workflowRunId,
              stepName: "finalize",
              timestamp: Date.now(),
            });

            await new Promise((resolve) => setTimeout(resolve, 1500));
            const res = {
              completed: true,
              finalizedAt: Date.now(),
            };
            await channel.emit("workflow.update", {
              type: "stepFinish",
              workflowRunId,
              stepName: "finalize",
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
            stepName: "finalize",
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : "Unknown error",
          });
          throw error;
        }
      }

      await channel.emit("workflow.update", {
        type: "runFinish",
        workflowRunId,
        timestamp: Date.now(),
        status: "success",
      });
      return {
        success: true,
        approved: eventData.approved,
        workflowRunId
      };
    } catch (error) {
      if (error instanceof WorkflowAbort) {
        throw error;
      }
      await channel.emit("workflow.update", {
        type: "stepFail",
        workflowRunId,
        stepName: "process-approval",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await channel.emit("workflow.update", {
        type: "runFinish",
        workflowRunId,
        timestamp: Date.now(),
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
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
