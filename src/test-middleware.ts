import { WorkflowMiddleware } from "./middleware";
import type { MiddlewareCallbacks } from "./types";

export type LogEntry = {
  type: keyof MiddlewareCallbacks;
  params: unknown;
};

/**
 * Test middleware that collects all callback invocations for testing
 */
export const createTestMiddleware = () => {
  const logs: LogEntry[] = [];

  const middleware = new WorkflowMiddleware({
    name: "test-logger",
    callbacks: {
      beforeExecution(params) {
        logs.push({ type: "beforeExecution", params });
      },
      afterExecution(params) {
        logs.push({ type: "afterExecution", params });
      },
      runStarted(params) {
        logs.push({ type: "runStarted", params });
      },
      runCompleted(params) {
        logs.push({ type: "runCompleted", params });
      },
      onError(params) {
        logs.push({ type: "onError", params });
      },
      onWarning(params) {
        logs.push({ type: "onWarning", params });
      },
    },
  });

  return {
    middleware,
    logs,
    clear: () => {
      logs.length = 0;
    },
    getLogs: () => logs,
    getLogsByType: (type: keyof MiddlewareCallbacks) => logs.filter((log) => log.type === type),
  };
};
