---
title: "Wait and Notify"
description: "Pause workflows until an event or webhook arrives, then resume execution."
---

Waiting for external events is a common workflow requirement: payment confirmation, webhook delivery, manual approval, or async processing. Upstash Workflow supports two ways to pause and resume workflows: `waitForEvent` and `waitForWebhook`.

**Problem**
You need a workflow to pause and resume later based on an external event without holding runtime or manually persisting state.

**Solution**
Use `context.waitForEvent` to pause until an event is notified, or `context.createWebhook` and `context.waitForWebhook` to wait for an HTTP callback. Both methods store state in QStash and resume when the event arrives or a timeout is reached.

<Steps>
<Step>
### Wait for a named event
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve(async (context) => {
  const result = await context.waitForEvent<{ approved: boolean }>(
    "approval",
    "order.approved",
    { timeout: "2h" }
  );

  if (result.timeout) {
    await context.run("timeout", () => console.warn("approval timed out"));
    return;
  }

  await context.run("continue", () => console.log("approved", result.eventData));
});
```
</Step>
<Step>
### Notify waiting workflows
```typescript filename="scripts/notify.ts"
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

await client.notify({
  eventId: "order.approved",
  eventData: { approved: true },
});
```
</Step>
<Step>
### Wait for a webhook
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve(async (context) => {
  const webhook = await context.createWebhook("create-webhook");
  await context.run("publish-url", () => console.log(webhook.webhookUrl));

  const { timeout, request } = await context.waitForWebhook(
    "wait-webhook",
    webhook,
    "1h"
  );

  if (!timeout) {
    await context.run("handle", async () => {
      const body = await request!.text();
      console.log("webhook payload", body);
    });
  }
});
```
</Step>
</Steps>

**Notes**
- `waitForEvent` uses a QStash wait endpoint under the hood (`src/context/steps.ts`).
- `waitForWebhook` creates a unique event ID and constructs a webhook URL using your QStash token (`src/context/steps.ts` and `src/utils.ts`).
- Always choose unique `eventId` values for logical events to avoid cross-talk between unrelated workflows.
