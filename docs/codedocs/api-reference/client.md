---
title: "Client"
description: "Trigger, cancel, notify, and inspect workflow runs via the workflow client."
---

`Client` is the main control-plane API for workflows. It wraps the QStash client and provides methods for triggering workflows, canceling runs, notifying events, listing waiters, and fetching logs. The implementation lives in `src/client/index.ts`.

**Constructor**
```typescript
new Client(config: ConstructorParameters<typeof QStashClient>[0])
```

**Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `config` | `@upstash/qstash` client config | — | QStash configuration including `token` and optional `baseUrl`. |

**Methods**

`trigger` creates one or more workflow runs:
```typescript
client.trigger(options: TriggerOptions): Promise<{ workflowRunId: string }>
client.trigger(options: TriggerOptions[]): Promise<{ workflowRunId: string }[]>
```

`cancel` stops workflow runs:
```typescript
client.cancel(id: string | string[] | WorkflowRunCancelFilters): Promise<{ cancelled: number }>
```

`notify` resumes workflows waiting for an event:
```typescript
client.notify({ eventId, eventData, workflowRunId? }): Promise<NotifyResponse[]>
```

`getWaiters` lists workflows waiting for an event:
```typescript
client.getWaiters({ eventId }): Promise<Required<Waiter>[]>
```

`logs` fetches workflow run logs:
```typescript
client.logs(params?): Promise<WorkflowRunLogs>
```

**TriggerOptions**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | Workflow URL to trigger. |
| `body` | `unknown` | — | Initial payload. |
| `headers` | `Record<string, string>` | — | Headers forwarded to the workflow. |
| `workflowRunId` | `string` | Random | Optional run ID suffix. Final ID is `wfr_${id}`. |
| `retries` | `number` | `3` | Retry count for first invocation. |
| `retryDelay` | `string` | Exponential | Custom retry delay expression. |
| `flowControl` | `FlowControl` | — | QStash flow control settings. |
| `delay` | <code>number &#124; string</code> | — | Delay before first invocation. |
| `notBefore` | `number` | — | Absolute Unix timestamp to delay execution. |
| `label` | `string` | — | Label for filtering logs. |
| `disableTelemetry` | `boolean` | `false` | Disable telemetry headers. |
| `failureUrl` | `string` | — | URL to call on failure. |
| `redact` | <code>&#123; body?: true; header?: true &#124; string[] &#125;</code> | — | Redact fields in logs. |

**Example**
```typescript filename="scripts/trigger.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

const { workflowRunId } = await client.trigger({
  url: "https://example.com/api/workflow",
  body: { task: "sync" },
  retries: 5,
});

await client.notify({ eventId: "sync.done", eventData: { ok: true } });
```

**Related**
- `src/client/index.ts`
- `src/client/types.ts`
- `src/client/filter-types.ts`
