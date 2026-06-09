import { serveMany } from "@upstash/workflow/nextjs";
import { Client } from "@upstash/workflow";
import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "./define-agent";

/** Names of the agents in the set. */
type AgentName<A extends readonly AgentDefinition[]> = A[number]["name"];

/** Input type of the agent with name `N`. */
type AgentInput<A extends readonly AgentDefinition[], N extends AgentName<A>> =
  Extract<A[number], { name: N }> extends AgentDefinition<N, infer TInput>
    ? TInput
    : never;

export type ServeAgentsConfig<A extends readonly AgentDefinition[]> = {
  /**
   * Public base URL of this serve route, e.g. "http://localhost:3000/api/agents".
   * Used by the returned caller to trigger agents over HTTP.
   */
  baseUrl: string;
  /** The agents to expose. The first call into any of them is the entry point. */
  agents: A;
};

/**
 * Serve a set of agents under one route and get back a type-safe caller.
 *
 * Wraps `serveMany` (one catch-all route, agents addressable by name) and a
 * QStash `Client`. The returned `trigger`:
 *   - only accepts known agent names (compile-time + runtime checked),
 *   - validates the input against that agent's zod schema before sending,
 *   - returns the realtime `channel` to subscribe to for the live feed.
 */
export function serveAgents<const A extends readonly AgentDefinition[]>({
  baseUrl,
  agents,
}: ServeAgentsConfig<A>) {
  const workflows = Object.fromEntries(agents.map((a) => [a.name, a.workflow]));
  const { POST } = serveMany(workflows);

  const client = new Client({
    baseUrl: process.env.QSTASH_URL,
    token: process.env.QSTASH_TOKEN!,
  });

  async function trigger<N extends AgentName<A>>(
    name: N,
    input: AgentInput<A, N>
  ): Promise<{ channel: string; workflowRunId: string }> {
    const agent = agents.find((a) => a.name === name);
    if (!agent) {
      throw new Error(
        `Unknown agent "${String(name)}". Known agents: ${agents
          .map((a) => a.name)
          .join(", ")}`
      );
    }

    // Runtime validation — the same schema the agent enforces on receipt.
    const validInput = agent.inputSchema.parse(input);

    // The run id doubles as the realtime channel for the whole agent tree.
    const channel = randomUUID();
    await client.trigger({
      url: `${baseUrl}/${String(name)}`,
      body: { input: validInput, channel },
      workflowRunId: channel,
    });

    return { channel, workflowRunId: channel };
  }

  return { POST, trigger };
}
