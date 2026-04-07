---
title: "Upstash Workflow JS"
description: "Build durable, reliable serverless workflows with step-based execution, retries, scheduling, and external calls via QStash."
---

Upstash Workflow JS is a TypeScript SDK for building durable, step-based serverless workflows that can pause, resume, retry, and call third-party APIs without holding runtime.

**The Problem**
- Serverless functions are short-lived, so long-running jobs, waits, and retries are painful to implement safely.
- Traditional background queues require infrastructure, retries, and state tracking that you must manage.
- External API calls can block runtime and make workloads expensive or flaky.
- Recovering from failures and continuing workflows is hard without durable state.

**The Solution**
Upstash Workflow JS treats each workflow action as a durable step. Steps are submitted to QStash and rehydrated on the next invocation, so your code remains simple while execution becomes reliable.

```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve<string>(async (context) => {
  const input = context.requestPayload;

  const step1 = await context.run("normalize", () => input.trim());
  await context.sleep("wait", "5s");
  const { body } = await context.call<{ ok: boolean }>("ping", {
    url: "https://example.com/health",
    method: "GET",
  });

  return { step1, ok: body.ok };
});
```

**Installation**
<Tabs items={["npm", "pnpm", "yarn", "bun"]}>
<Tab value="npm">
```bash
npm install @upstash/workflow
```
</Tab>
<Tab value="pnpm">
```bash
pnpm add @upstash/workflow
```
</Tab>
<Tab value="yarn">
```bash
yarn add @upstash/workflow
```
</Tab>
<Tab value="bun">
```bash
bun add @upstash/workflow
```
</Tab>
</Tabs>

**Quick Start**
```typescript filename="app/api/workflow/route.ts"
import { serve } from "@upstash/workflow/nextjs";

const someWork = (input: string) => `processed ${input}`;

export const { POST } = serve<string>(async (context) => {
  const input = context.requestPayload;

  const first = await context.run("step1", () => someWork(input));
  await context.run("step2", () => someWork(first));

  return { ok: true };
});
```

Expected output in logs (simplified):
```text
step1 -> processed hello
step2 -> processed processed hello
```

**Key Features**
- Durable steps with retries and deduplication
- Built-in sleep, wait-for-event, and webhook steps
- Third-party calls without consuming runtime
- Multi-workflow routing with `serveMany`
- Workflow client for trigger, cancel, notify, logs, and DLQ
- Middleware hooks for debugging and lifecycle observability

<Cards>
  <Card title="Architecture" href="/docs/architecture">How the SDK is structured and how requests flow</Card>
  <Card title="Core Concepts" href="/docs/workflow-context">Understand context, steps, and execution</Card>
  <Card title="API Reference" href="/docs/api-reference/serve">Full API details for serve, client, and more</Card>
</Cards>
