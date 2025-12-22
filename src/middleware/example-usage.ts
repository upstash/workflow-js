/**
 * Example Usage of MiddlewareManager
 *
 * This demonstrates how to use the new simplified middleware system
 */

import { WorkflowContext } from "../context";
import { MiddlewareManager } from "./manager";
import { loggingMiddleware } from "./logging";

// 2. Create a MiddlewareManager with your middlewares
const manager = new MiddlewareManager<{ foo: string }, number>([loggingMiddleware]);

// 3. Assign workflow run ID (for debug events)
manager.assignWorkflowRunId("run-123");

// 4. Use dispatch for debug events (no generics needed!)
await manager.dispatchDebug("onError", { error: new Error("Something went wrong") });
await manager.dispatchDebug("onWarning", { warning: "This is a warning" });
await manager.dispatchDebug("onInfo", { info: "Just some info" });

// 5. Assign context (required for lifecycle events)
// Note: This is just an example - in real usage, you'd get the context from your workflow
const context = {
  requestPayload: { foo: "bar" },
  // Add other required context properties as needed
} as WorkflowContext<{ foo: string }>;

manager.assignContext(context);

// 6. Use dispatch for lifecycle events
await manager.dispatchLifecycle("runStarted", {});
await manager.dispatchLifecycle("beforeExecution", { stepName: "step1" });
await manager.dispatchLifecycle("afterExecution", { stepName: "step1", result: { success: true } });
await manager.dispatchLifecycle("runCompleted", { result: 12 });
