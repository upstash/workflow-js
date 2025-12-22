import { onErrorWithConsole, onInfoWithConsole, onWarningWithConsole } from "./default-callbacks";
import { WorkflowMiddleware } from "./middleware";

export const loggingMiddleware = new WorkflowMiddleware<unknown>({
  name: "logging",
  callbacks: {
    afterExecution(params) {
      console.log("  [Upstash Workflow]: Step executed:", params);
    },
    beforeExecution(params) {
      console.log("  [Upstash Workflow]: Step execution started:", params);
    },
    runStarted(params) {
      console.log("  [Upstash Workflow]: Workflow run started:", params);
    },
    runCompleted(params) {
      console.log("  [Upstash Workflow]: Workflow run completed:", params);
    },
    onError: onErrorWithConsole,
    onWarning: onWarningWithConsole,
    onInfo: onInfoWithConsole,
  },
});
