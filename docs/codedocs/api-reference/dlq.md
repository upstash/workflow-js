---
title: "DLQ"
description: "Inspect and manage workflow messages in the Dead Letter Queue."
---

`DLQ` is accessed via `client.dlq` and provides methods to list, resume, restart, retry failure callbacks, and delete workflow messages that ended up in the dead letter queue. The implementation lives in `src/client/dlq.ts`.

**Accessing DLQ**
```typescript
const client = new Client({ token: process.env.QSTASH_TOKEN! });
const dlq = client.dlq;
```

**Methods**

`list` lists DLQ entries:
```typescript
dlq.list({ cursor?, count?, filter? })
```

`resume` resumes failed workflow runs from the point of failure:
```typescript
dlq.resume(dlqId | dlqId[] | WorkflowDLQActionFilters, options?)
```

`restart` restarts workflow runs from the beginning:
```typescript
dlq.restart(dlqId | dlqId[] | WorkflowDLQActionFilters, options?)
```

`retryFailureFunction` replays a failure callback:
```typescript
dlq.retryFailureFunction({ dlqId })
```

`delete` removes DLQ entries:
```typescript
dlq.delete(dlqId | dlqId[] | WorkflowDLQActionFilters)
```

**Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dlqId` | `string` | — | DLQ message ID. |
| `filter` | `WorkflowDLQListFilters` | — | Filter by workflow URL, run ID, date range, label, and more. |
| `count` | `number` | `100` | Max items per call for bulk operations. |
| `cursor` | `string` | — | Cursor for pagination. |
| `options` | `{ flowControl?, retries? }` | — | Overrides for resume/restart. |

**Usage patterns**
- **Resume** when you want to continue from the failed step using the same payload and workflow state.
- **Restart** when you want to run the workflow from the beginning with the original payload.
- **Retry failure function** when the failure callback itself failed.

**Example: list and resume**
```typescript filename="scripts/dlq.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

const { messages, cursor } = await client.dlq.list({
  count: 20,
  filter: { label: "billing" },
});

if (messages.length > 0) {
  await client.dlq.resume(messages[0].dlqId, { retries: 5 });
}
```

**Example: process all DLQ items**
```typescript filename="scripts/dlq-bulk.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

let cursor: string | undefined;

do {
  const result = await client.dlq.restart({ all: true, count: 100, cursor });
  cursor = result.cursor;
} while (cursor);
```

**Related**
- `src/client/dlq.ts`
- `src/client/filter-types.ts`
