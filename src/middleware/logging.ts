import { WorkflowMiddleware } from "./middleware";

export const loggingMiddleware = new WorkflowMiddleware({
  name: "logging",
  init: () => {
    console.log("Logging middleware initialized");

    return {
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
    };
  },
});
