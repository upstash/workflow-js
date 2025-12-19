import { onErrorWithConsole, onWarningWithConsole, WorkflowMiddleware } from "./middleware";

export const loggingMiddleware = new WorkflowMiddleware({
  name: "logging",
  callbacks: {
    afterExecution(params) {
      console.log("Step executed:", params);
    },
    beforeExecution(params) {
      console.log("Step execution started:", params);
    },
    runStarted(params) {
      console.log("Workflow run started:", params);
    },
    runCompleted(params) {
      console.log("Workflow run completed:", params);
    },
    onError: onErrorWithConsole,
    onWarning: onWarningWithConsole,
  },
});
