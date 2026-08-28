---
title: "Middleware"
description: "Define workflow middleware for lifecycle and debug events."
---

The middleware API lets you intercept workflow lifecycle events and debug signals. It is defined in `src/middleware/middleware.ts` and managed by `src/middleware/manager.ts`. Middleware is attached via the `middlewares` option to `serve` or added automatically when `verbose: true` is enabled.

**WorkflowMiddleware**
```typescript
new WorkflowMiddleware<TInitialPayload, TResult>({
  name: string,
  callbacks?: MiddlewareCallbacks<TInitialPayload, TResult>,
  init?: MiddlewareInitCallbacks<TInitialPayload, TResult>
})
```

**Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Middleware name. |
| `callbacks` | `MiddlewareCallbacks` | — | Direct callbacks for events. |
| `init` | `() => MiddlewareCallbacks` | — | Async initializer for callbacks. |

**Lifecycle events**
- `beforeExecution` and `afterExecution` are fired around step submission (`src/qstash/submit-steps.ts`).
- `runStarted` and `runCompleted` are fired at workflow boundaries (`src/serve/index.ts`).

**Debug events**
- `onInfo`, `onWarning`, and `onError` are emitted during request parsing and execution (`src/serve/index.ts`, `src/workflow-parser.ts`, `src/workflow-requests.ts`).

**Example**
```typescript filename="src/middleware/metrics.ts"
import { WorkflowMiddleware } from "@upstash/workflow";

export const metrics = new WorkflowMiddleware({
  name: "metrics",
  callbacks: {
    beforeExecution: ({ stepName }) => console.log("start", stepName),
    afterExecution: ({ stepName }) => console.log("end", stepName),
    onWarning: ({ warning }) => console.warn(warning),
  },
});
```

**Example: async init**
```typescript filename="src/middleware/init.ts"
import { WorkflowMiddleware } from "@upstash/workflow";

export const tracing = new WorkflowMiddleware({
  name: "tracing",
  init: async () => {
    const client = await createTracingClient();
    return {
      runStarted: () => client.startSpan("workflow"),
      runCompleted: ({ result }) => client.endSpan({ result }),
      onError: ({ error }) => client.capture("error", error.message),
    };
  },
});
```

**loggingMiddleware**
`loggingMiddleware` is a built-in middleware that emits structured logs. It is defined in `src/middleware/logging.ts` and is automatically included when `verbose: true` is passed to `serve`.

**Related**
- `src/middleware/middleware.ts`
- `src/middleware/manager.ts`
- `src/middleware/types.ts`

**Implementation notes**
`MiddlewareManager` ensures every middleware is initialized once per request via `ensureInit`, and it wraps callback execution with a safe error path. If a middleware throws, the manager attempts to call its `onError` callback, falling back to console logging. This prevents broken middleware from crashing workflow execution while still surfacing diagnostics.
