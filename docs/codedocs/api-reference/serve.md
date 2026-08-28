---
title: "serve"
description: "Create a workflow handler that runs your route function as a durable workflow."
---

`serve` is the primary entry point for creating a workflow endpoint. It wraps `serveBase` from `src/serve/index.ts` and returns a framework-specific handler depending on the adapter you use.

**Signature**
```typescript
export const serve = <TInitialPayload = unknown, TResult = unknown>(
  routeFunction: RouteFunction<TInitialPayload, TResult>,
  options?: WorkflowServeOptions<TInitialPayload, TResult>
) => {
  // returns a handler
};
```

**Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `routeFunction` | `(context: WorkflowContext<TInitialPayload>) => Promise<TResult>` | — | Your workflow function that declares steps. |
| `options` | `WorkflowServeOptions<TInitialPayload, TResult>` | `{}` | Configuration for clients, parsing, validation, and middleware. |

**WorkflowServeOptions**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `qstashClient` | `WorkflowClient` or `QStashClientExtraConfig` | Env-based client | Provide a QStash client or configuration (token/url are read from env). |
| `receiver` | `WorkflowReceiver` | Env-based receiver | Verify incoming requests using QStash signing keys. |
| `url` | `string` | Derived from request | Explicit workflow URL if inference is not desired. |
| `baseUrl` | `string` | `UPSTASH_WORKFLOW_URL` | Replace base URL for callbacks. |
| `schema` | `z.ZodType<TInitialPayload>` | — | Zod validation for request payloads. |
| `initialPayloadParser` | `(payload: string) => TInitialPayload` | JSON parse | Custom payload parsing. Mutually exclusive with `schema`. |
| `failureFunction` | `(payload) => void \\| string` | — | Failure handler after retries are exhausted. |
| `env` | <code>Record&lt;string, string &#124; undefined&gt;</code> | `process.env` | Environment map for runtimes without `process.env`. |
| `middlewares` | `WorkflowMiddleware[]` | `[]` | Middleware list for debug and lifecycle events. |
| `disableTelemetry` | `boolean` | `false` | Turn off telemetry headers. |
| `verbose` | `boolean` | `false` | Adds built-in logging middleware. |

**Return type**
The return value is platform-specific. For example, `@upstash/workflow/nextjs` returns `{ POST }`, while `@upstash/workflow/cloudflare` returns `{ fetch }`.

**Example**
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve(async (context) => {
  await context.run("step1", () => console.log("hello"));
});
```

**Related**
- `src/serve/index.ts`
- `src/serve/options.ts`
- `src/workflow-parser.ts`
- `src/workflow-requests.ts`
