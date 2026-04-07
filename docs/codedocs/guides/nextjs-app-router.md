---
title: "Next.js App Router"
description: "Serve a workflow in the Next.js App Router with step-based execution and retries."
---

This guide shows how to expose a workflow endpoint in a Next.js App Router project. You will define a workflow route, trigger it, and see the durable step behavior. The workflow code will run across multiple invocations as steps are submitted and replayed.

**Problem**
You want a serverless endpoint that can pause, retry, and call external services without keeping a Node.js runtime alive.

**Solution**
Use the Next.js adapter `@upstash/workflow/nextjs` and the `serve` helper. It wraps `serveBase` so the handler integrates with the App Router while still using the workflow protocol.

<Steps>
<Step>
### Install the package
```bash
npm install @upstash/workflow
```
</Step>
<Step>
### Add environment variables
Set the following variables in your deployment:
- `QSTASH_URL`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

Optionally set:
- `UPSTASH_WORKFLOW_URL` if you want to override the base URL used for callbacks.
</Step>
<Step>
### Create the workflow route
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve<{ email: string }>(async (context) => {
  const { email } = context.requestPayload;

  const normalized = await context.run("normalize", () => email.trim().toLowerCase());

  await context.sleep("cooldown", "30s");

  const { status } = await context.call("subscribe", {
    url: "https://example.com/subscribe",
    method: "POST",
    body: JSON.stringify({ email: normalized }),
    headers: { "content-type": "application/json" },
  });

  if (status !== 200) {
    await context.run("alert", () => console.warn("subscribe failed"));
  }
});
```
</Step>
<Step>
### Trigger the workflow
```typescript filename="scripts/trigger.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

const { workflowRunId } = await client.trigger({
  url: "https://your-app.com/api/workflow",
  body: { email: "hello@example.com" },
});

console.log(workflowRunId);
```
</Step>
</Steps>

**What you should see**
- The initial invocation starts the workflow and queues steps in QStash.
- Each step produces a QStash message; the workflow endpoint is re-invoked.
- The workflow completes after the final step is submitted and replayed.

If you need to customize parsing or validation, add `schema` or `initialPayloadParser` in the `serve` options (see `src/serve/options.ts`). If you need to disable telemetry for compliance, set `disableTelemetry: true` in both `serve` options and `client.trigger`.
