---
title: "WorkflowContext"
description: "Public API for defining workflow steps and accessing runtime metadata."
---

`WorkflowContext` is the object passed into your workflow route function. It exposes step methods and runtime metadata such as `workflowRunId`, `requestPayload`, and `env`. Implementation is in `src/context/context.ts`.

**Constructor (internal)**
```typescript
new WorkflowContext({
  qstashClient,
  workflowRunId,
  workflowRunCreatedAt,
  headers,
  steps,
  url,
  initialPayload,
  env,
  telemetry,
  invokeCount,
  label,
  middlewareManager,
})
```

Most users do not construct this directly. It is created by `serveBase`.

**Properties**
| Property | Type | Description |
|---------|------|-------------|
| `qstashClient` | `WorkflowClient` | QStash client used for submissions. |
| `workflowRunId` | `string` | Unique workflow run ID. |
| `workflowRunCreatedAt` | `number` | Creation timestamp in milliseconds. |
| `url` | `string` | Workflow URL. |
| `requestPayload` | `TInitialPayload` | Parsed initial payload. |
| `headers` | `Headers` | User headers from the initial request. |
| `env` | <code>Record&lt;string, string &#124; undefined&gt;</code> | Environment variables. |
| `label` | <code>string &#124; undefined</code> | Workflow label. |
| `api` | `WorkflowApi` | Provider helpers for OpenAI, Anthropic, Resend. |

**Methods**
| Method | Signature | Description |
|--------|-----------|-------------|
| `run` | `(stepName, fn) => Promise<TResult>` | Run a durable step. |
| `sleep` | `(stepName, duration) => Promise<void>` | Pause for a duration. |
| `sleepUntil` | `(stepName, datetime) => Promise<void>` | Pause until a timestamp. |
| `call` | `(stepName, settings) => Promise<CallResponse>` | Call external APIs via QStash. |
| `waitForEvent` | `(stepName, eventId, options?) => Promise<WaitStepResponse>` | Wait for an event or timeout. |
| `notify` | `(stepName, eventId, eventData, workflowRunId?) => Promise<NotifyStepResponse>` | Notify waiters. |
| `invoke` | `(stepName, params) => Promise<InvokeStepResponse>` | Invoke another workflow. |
| `createWebhook` | `(stepName) => Promise<Webhook>` | Generate a webhook URL. |
| `waitForWebhook` | `(stepName, webhook, timeout) => Promise<WaitForWebhookResponse>` | Wait for webhook or timeout. |
| `cancel` | `() => Promise<void>` | Cancel workflow run (throws internally). |

**Example**
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve(async (context) => {
  const user = await context.run("fetch", () => ({ id: "u1" }));
  await context.sleep("pause", "5s");
  await context.notify("notify", "user.ready", user);
});
```

**Related**
- `src/context/context.ts`
- `src/context/steps.ts`
- `src/context/api/index.ts`
