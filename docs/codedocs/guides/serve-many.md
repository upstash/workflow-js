---
title: "Serve Many Workflows"
description: "Route multiple workflows from a single endpoint using serveMany."
---

When you have multiple workflows in the same application, it is often easier to expose a single endpoint and route based on the last path segment. `serveMany` does this by mapping workflow IDs to handlers and ensuring each workflow has a stable, unique name.

**Problem**
You need to host multiple workflows without creating a separate endpoint and deploy target for each one.

**Solution**
Use `createWorkflow` and `serveMany` from your platform adapter. This uses `serveManyBase` in `src/serve/serve-many.ts`, which validates workflow IDs, assigns them to the workflow definition, and routes based on the URL.

<Steps>
<Step>
### Create workflow definitions
```typescript filename="app/api/workflows/[...slug]/route.ts"
import type { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";

const workflowOne = createWorkflow(async (context) => {
  await context.run("step1", () => console.log("workflow one"));
  return "one";
});

const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
  await context.run("step1", () => console.log("workflow two"));
  return "two";
});

export const { POST } = serveMany({
  workflowOne,
  workflowTwo,
});
```
</Step>
<Step>
### Trigger a specific workflow
```typescript filename="scripts/trigger.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

await client.trigger({
  url: "https://your-app.com/api/workflows/workflowOne",
  body: { ok: true },
});
```
</Step>
</Steps>

**How routing works**
- `serveManyBase` reads the last path segment and matches it to a workflow ID.
- It throws a `WorkflowError` if a workflow name contains `/` or duplicates an existing name.
- Each workflow gets its own `workflowId`, which is used for `context.invoke` and for deriving URLs when invoking child workflows.

**Tips**
- Pick stable workflow IDs since they become part of your URL and are used to derive child workflow URLs.
- If you need different shared options (like middleware or telemetry), pass them in the `serveMany` options and override per workflow as needed.
- If you call `context.invoke`, use the workflow object returned by `createWorkflow` so it already includes the correct workflow ID.
