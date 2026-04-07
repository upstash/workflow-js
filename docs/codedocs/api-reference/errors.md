---
title: "Errors"
description: "Workflow-specific error classes and how they influence execution."
---

Upstash Workflow uses specialized error classes to control execution flow and communicate failure semantics. These are defined in `src/error.ts` and are used internally by `serveBase`, `AutoExecutor`, and step handling logic.

**WorkflowError**
```typescript
class WorkflowError extends QstashError
```
Used for workflow-specific validation and runtime errors. Examples include invalid step names, incompatible parallel steps, and invalid workflow IDs.

**WorkflowAbort**
```typescript
class WorkflowAbort extends Error
```
Thrown internally to stop the current invocation after a step submission. This is expected behavior and should not be swallowed by `try/catch` in user code.

**WorkflowAuthError**
```typescript
class WorkflowAuthError extends WorkflowAbort
```
Thrown during the dry-run authorization pass when a step is detected in `DisabledWorkflowContext` (`src/serve/authorization.ts`).

**WorkflowCancelAbort**
```typescript
class WorkflowCancelAbort extends WorkflowAbort
```
Thrown when you call `context.cancel()` to stop a workflow run.

**WorkflowNonRetryableError**
```typescript
class WorkflowNonRetryableError extends WorkflowAbort
```
Signals that a workflow should not be retried. `serve` responds with status `489` and sets `Upstash-NonRetryable-Error: true`.

**WorkflowRetryAfterError**
```typescript
class WorkflowRetryAfterError extends WorkflowAbort
```
Signals that a workflow should be retried after a specific delay. `serve` responds with status `429` and a `Retry-After` header.

**Example: non-retryable failure**
```typescript filename="app/api/workflow/route.ts"
import { serve, WorkflowNonRetryableError } from "@upstash/workflow";

export const { POST } = serve(async (context) => {
  await context.run("validate", () => {
    throw new WorkflowNonRetryableError("invalid input");
  });
});
```

**Example: retry after delay**
```typescript filename="app/api/workflow/route.ts"
import { serve, WorkflowRetryAfterError } from "@upstash/workflow";

export const { POST } = serve(async (context) => {
  await context.run("rate-limit", () => {
    throw new WorkflowRetryAfterError("try later", "60s");
  });
});
```

**Related**
- `src/error.ts`
- `src/serve/options.ts`
- `src/workflow-requests.ts`

**Implementation notes**
`formatWorkflowError` converts unknown errors into a consistent `FailureFunctionPayload`, and `isInstanceOf` performs prototype-chain checks to handle errors across runtime boundaries. These helpers make error handling more reliable when exceptions cross worker boundaries or are serialized and rehydrated.
