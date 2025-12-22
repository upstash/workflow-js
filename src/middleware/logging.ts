import { onErrorWithConsole, onInfoWithConsole, onWarningWithConsole } from "./default-callbacks";
import { WorkflowMiddleware } from "./middleware";

export const loggingMiddleware = new WorkflowMiddleware<unknown>({
  name: "logging",
  callbacks: {
    afterExecution(params) {
      const { context, ...rest } = params;
      console.log("  [Upstash Workflow]: Step executed:", {
        workflowRunId: context.workflowRunId,
        ...rest,
      });
    },
    beforeExecution(params) {
      const { context, ...rest } = params;
      console.log("  [Upstash Workflow]: Step execution started:", {
        workflowRunId: context.workflowRunId,
        ...rest,
      });
    },
    runStarted(params) {
      const { context, ...rest } = params;
      console.log("  [Upstash Workflow]: Workflow run started:", {
        workflowRunId: context.workflowRunId,
        ...rest,
      });
    },
    runCompleted(params) {
      const { context, ...rest } = params;
      console.log("  [Upstash Workflow]: Workflow run completed:", {
        workflowRunId: context.workflowRunId,
        ...rest,
      });
    },
    onError: onErrorWithConsole,
    onWarning: onWarningWithConsole,
    onInfo: onInfoWithConsole,
  },
});
