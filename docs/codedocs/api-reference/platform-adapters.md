---
title: "Platform Adapters"
description: "Framework-specific entrypoints that wrap serveBase for common runtimes."
---

Platform adapters are thin wrappers around `serveBase` that adapt to framework handler signatures. They live under `platforms/` and are exported via package subpaths such as `@upstash/workflow/nextjs`. Each adapter sets framework-specific telemetry and passes framework runtime details to `serveBase`.

**Available adapters**
- `@upstash/workflow/nextjs` (`platforms/nextjs.ts`)
- `@upstash/workflow/cloudflare` (`platforms/cloudflare.ts`)
- `@upstash/workflow/hono` (`platforms/hono.ts`)
- `@upstash/workflow/express` (`platforms/express.ts`)
- `@upstash/workflow/astro` (`platforms/astro.ts`)
- `@upstash/workflow/svelte` (`platforms/svelte.ts`)
- `@upstash/workflow/solidjs` (`platforms/solidjs.ts`)
- `@upstash/workflow/h3` (`platforms/h3.ts`)
- `@upstash/workflow/tanstack` (`platforms/tanstack.ts`)
- `@upstash/workflow/react-router` (`platforms/react-router.ts`)

**Common exports**
Most adapters export the same helpers:
| Export | Description |
|--------|-------------|
| `serve` | Build a handler for a single workflow. |
| `createWorkflow` | Create an invokable workflow definition. |
| `serveMany` | Route multiple workflows based on URL. |

**Handler shapes by platform**
- Next.js App Router: `{ POST }` handler (Request in, Response out).
- Cloudflare Workers and Pages: `{ fetch }` handler.
- Express: middleware function `(req, res)`.
- Hono and other adapters: framework-specific handler function.

**Next.js extras**
The Next.js adapter also exports `servePagesRouter`, `createWorkflowPagesRouter`, and `serveManyPagesRouter` for the pages router API (`platforms/nextjs.ts`).

**Example: Cloudflare**
```typescript filename="src/index.ts"
import { serve } from "@upstash/workflow/cloudflare";

export default serve(async (context) => {
  await context.run("hello", () => "world");
});
```

**Example: Express**
```typescript filename="server.ts"
import express from "express";
import { serve } from "@upstash/workflow/express";

const app = express();
app.use(express.json());

const { handler } = serve(async (context) => {
  await context.run("hello", () => "world");
});

app.post("/workflow", handler);
```

**How adapters map to core execution**
Each adapter calls `serveBase` from `src/serve/index.ts` and only adapts the handler signature. This keeps feature parity between frameworks while letting you choose the runtime that fits your deployment. If you ever need a custom runtime, you can build your own adapter by calling `serveBase` directly and translating requests to the standard `Request` shape used by the SDK.

**Related**
- `platforms/nextjs.ts`
- `platforms/cloudflare.ts`
- `platforms/astro.ts`
- `platforms/express.ts`
