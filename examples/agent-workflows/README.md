# Agent SDK on Upstash Workflow

A tiny, opinionated "SDK" built on top of Upstash Workflow that makes durable,
multi-agent apps feel like writing a few lines of config. You define agents,
serve them with one call, and call them with a type-safe function — while every
agent streams what it's doing to the browser in real time.

## The whole surface (4 exports)

```ts
import { defineAgent } from "./app/_sdk/define-agent";
import { serveAgents } from "./app/_sdk/serve-agents";
import { useRealtime } from "./app/_sdk/realtime-client";
```

| Export | Wraps | What it gives you |
| --- | --- | --- |
| `defineAgent(config)` | `createWorkflow` + `agentWorkflow` | An independently invokable, durable agent with zod-validated input, a built-in `log` tool, and per-step realtime events. |
| `serveAgents({ baseUrl, agents })` | `serveMany` + `Client` | A single route for all agents **and** a typed `trigger(name, input)` that validates the name + input before dispatching. |
| `trigger(name, input)` | `client.trigger` | Returned by `serveAgents`. Compile-time + runtime checked. Returns the realtime `channel` to watch. |
| `useRealtime(...)` | `@upstash/realtime` | Typed React hook; subscribe to a run's channel and render the live feed. |

## Defining and serving agents

See [`app/agents.ts`](./app/agents.ts) — an orchestrator that delegates to a
researcher and a writer:

```ts
const researcher = defineAgent({
  name: "researcher",
  description: "Gathers key facts about a topic.",
  input: z.object({ topic: z.string() }),
  background: "You are a thorough research assistant…",
});

const orchestrator = defineAgent({
  name: "orchestrator",
  description: "Coordinates research and writing.",
  input: z.object({ request: z.string() }),
  background: "Log a plan, call `researcher`, then `writer`…",
  subagents: [researcher, writer], // ← become type-safe context.invoke tools
});

export const { POST, trigger } = serveAgents({
  baseUrl: `${process.env.APP_URL}/api/agents`,
  agents: [orchestrator, researcher, writer],
});
```

`subagents` are exposed to the LLM as tools that call `context.invoke` under the
hood, so the whole tree runs as cooperating durable workflows. The root run id
is threaded through every invocation, so all agents report to **one** realtime
channel.

## How the pieces connect

```
 page.tsx
   │  startAgent(request) ─▶ trigger("orchestrator", { request })   (zod-validated)
   │  client.trigger ─▶ QStash ─▶ POST /api/agents/orchestrator
   ▼
 orchestrator workflow
   ├─ log tool ──────────▶ emit "agent.log"
   ├─ invoke researcher ─▶ POST /api/agents/researcher   (same channel)
   └─ invoke writer ─────▶ POST /api/agents/writer       (same channel)
   │
   │  middleware emits "agent.start" / "agent.step" / "agent.finish"
   ▼
 page.tsx ◀─ useRealtime(channel) ─ GET /api/realtime   (SSE, Redis-backed)
```

## Run it

1. `pnpm install`
2. Fill in `.env` (Redis + QStash are set; **add your `OPENAI_API_KEY`**).
3. Start the local QStash dev server (already running in this setup).
4. `pnpm dev`, open http://localhost:3000, type a request, and watch the agents
   work live.
