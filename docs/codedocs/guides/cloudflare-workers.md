---
title: "Cloudflare Workers"
description: "Deploy workflows on Cloudflare Workers or Pages Functions using the Cloudflare adapter."
---

This guide shows how to run workflows on Cloudflare Workers or Pages Functions using the Cloudflare adapter. The adapter passes the Cloudflare `env` object into `serveBase` so environment variables work in the Workers runtime.

**Problem**
You want a durable workflow endpoint on Cloudflare that can pause, retry, and call external services without keeping the worker alive.

**Solution**
Use `@upstash/workflow/cloudflare`. It exposes a `fetch` handler compatible with Workers and Pages Functions, while still using the same workflow engine and step API.

<Steps>
<Step>
### Install the package
```bash
npm install @upstash/workflow
```
</Step>
<Step>
### Configure environment bindings
In `wrangler.toml` (Workers) or your Pages project settings, define:
- `QSTASH_TOKEN`
- `QSTASH_URL` (optional, defaults to the Upstash QStash URL)
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `UPSTASH_WORKFLOW_URL` (optional)
</Step>
<Step>
### Create the workflow handler
```typescript filename="src/index.ts"
import { serve } from "@upstash/workflow/cloudflare";

export default serve<{ orderId: string }>(async (context) => {
  const { orderId } = context.requestPayload;

  await context.run("reserve", () => console.log("reserve", orderId));

  const { body } = await context.call<{ ok: boolean }>("payment", {
    url: "https://example.com/pay",
    method: "POST",
    body: JSON.stringify({ orderId }),
    headers: { "content-type": "application/json" },
  });

  if (!body.ok) {
    await context.run("rollback", () => console.warn("payment failed"));
  }
});
```
</Step>
<Step>
### Trigger the workflow
```typescript filename="scripts/trigger.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

await client.trigger({
  url: "https://your-worker.example.workers.dev",
  body: { orderId: "ord_001" },
});
```
</Step>
</Steps>

**Notes**
- The adapter automatically passes the Cloudflare `env` object to `serveBase`, matching the logic in `platforms/cloudflare.ts`.
- If you need to override the URL used for callbacks, set `UPSTASH_WORKFLOW_URL`.
- If you want multiple workflows behind one endpoint, use `serveMany` from the same adapter (see the Serve Many guide).
