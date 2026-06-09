import { createWorkflow } from "@upstash/workflow/nextjs";
import { WorkflowMiddleware } from "@upstash/workflow";
import type { WorkflowContext, InvokableWorkflow } from "@upstash/workflow";
import { agentWorkflow } from "@upstash/workflow-agents";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { realtime } from "./realtime";

/**
 * Internal payload every agent workflow is triggered with.
 *
 * `input` is the user-facing, zod-validated payload. `channel` is the realtime
 * channel of the *root* run — threaded through sub-agent invocations so the
 * whole tree reports to one live feed.
 */
export type AgentEnvelope<TInput> = { input: TInput; channel: string };

/**
 * A defined agent. Holds its zod input schema (used to validate on both the
 * calling and receiving side) and the underlying invokable workflow.
 */
export type AgentDefinition<TName extends string = string, TInput = unknown> = {
  name: TName;
  description: string;
  inputSchema: z.ZodType<TInput>;
  // Payload is intentionally `any` here: the agent validates it with
  // `inputSchema` at runtime, and keeping it open avoids function-parameter
  // variance issues when agents are collected into a single array.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflow: InvokableWorkflow<any, { text: string }>;
};

export type DefineAgentConfig<TName extends string, TInput> = {
  /** Unique agent name. Becomes its route segment and the tool name when used as a sub-agent. */
  name: TName;
  /** One-line description, shown to any agent that can delegate to this one. */
  description: string;
  /** Zod schema for this agent's input. Validated when called and when received. */
  input: z.ZodType<TInput>;
  /** System prompt describing the agent's role and how to use its tools. */
  background: string;
  /** OpenAI model name. @default "gpt-4o-mini" */
  model?: string;
  /** Max LLM calls before the agent must stop. @default 5 */
  maxSteps?: number;
  /** Extra AI SDK tools available to the agent. */
  tools?: Record<string, Tool>;
  /** Other agents this agent may delegate to (via context.invoke, fully typed). */
  subagents?: AgentDefinition[];
  /** Maps the validated input to the prompt string. @default JSON.stringify */
  prompt?: (input: TInput) => string;
};

const defaultPrompt = (input: unknown) =>
  typeof input === "string" ? input : JSON.stringify(input);

/**
 * Define an agent. Wraps `createWorkflow` + the Workflow Agents API so the agent
 * is an independently invokable, durable workflow that:
 *
 *  - validates its incoming payload with the same zod schema callers use,
 *  - narrates its work over realtime (a built-in `log` tool + per-step events),
 *  - can delegate to its `subagents` through type-safe `context.invoke` calls.
 */
export function defineAgent<TName extends string, TInput>(
  config: DefineAgentConfig<TName, TInput>
): AgentDefinition<TName, TInput> {
  const { name, input, background, model, maxSteps, tools, subagents, prompt } =
    config;

  // The request body can be empty on some invocations (e.g. around a
  // context.call step), so always read the channel defensively and skip the
  // emit when it isn't there.
  const channelOf = (context: WorkflowContext<AgentEnvelope<TInput>>) =>
    (context.requestPayload as AgentEnvelope<TInput> | undefined)?.channel;

  // Broadcast lifecycle + per-step events on the root run's channel.
  const middleware = new WorkflowMiddleware<AgentEnvelope<TInput>, { text: string }>({
    name: "agent-realtime",
    callbacks: {
      runStarted: async ({ context }) => {
        const channel = channelOf(context);
        if (channel) await realtime.channel(channel).emit("agent.start", { agent: name });
      },
      afterExecution: async ({ context, stepName }) => {
        const channel = channelOf(context);
        if (channel)
          await realtime.channel(channel).emit("agent.step", { agent: name, stepName });
      },
      runCompleted: async ({ context, result }) => {
        const channel = channelOf(context);
        if (channel)
          await realtime
            .channel(channel)
            .emit("agent.finish", { agent: name, text: result?.text ?? "" });
      },
    },
  });

  const routeFunction = async (
    context: WorkflowContext<AgentEnvelope<TInput>>
  ): Promise<{ text: string }> => {
    // IMPORTANT: never read/verify the request body *before* the first step.
    // When the first step is a context.call (the agent's LLM call), the workflow
    // re-invokes this route with an empty body at points during the run; parsing
    // it at the top would throw ("error while authorizing request"). Doing it as
    // the first context.run step means it runs once with the real payload and is
    // replayed (not re-executed) on the empty-body invocations.
    const { input: validInput, channel } = await context.run("read input", () => {
      const payload = context.requestPayload as AgentEnvelope<TInput>;
      // Agents validate incoming payloads with the same schema callers use.
      return { input: input.parse(payload.input), channel: payload.channel };
    });

    const agents = agentWorkflow(context);
    const llm = agents.openai(model ?? "gpt-4o-mini");

    const agentTools: Record<string, Tool> = {
      // Built-in narration tool: the agent says what it is doing, live.
      log: tool({
        description:
          "Narrate what you are about to do, in one short sentence. " +
          "Call this before every other tool call and whenever your focus changes.",
        inputSchema: z.object({ message: z.string() }),
        execute: async ({ message }) => {
          await realtime.channel(channel).emit("agent.log", { agent: name, message });
          return "noted";
        },
      }),
      ...(tools ?? {}),
      ...buildSubagentTools(subagents ?? [], context, channel),
    };

    const agent = agents.agent({
      model: llm,
      name,
      maxSteps: maxSteps ?? 5,
      background,
      tools: agentTools,
    });

    const task = agents.task({ agent, prompt: (prompt ?? defaultPrompt)(validInput) });
    return task.run();
  };

  const workflow = createWorkflow<AgentEnvelope<TInput>, { text: string }>(
    routeFunction,
    { middlewares: [middleware] }
  );

  return { name, description: config.description, inputSchema: input, workflow };
}

/**
 * Turn each sub-agent into a tool the LLM can call. The tool delegates via
 * `context.invoke`, threading the realtime channel through so the sub-agent's
 * activity surfaces on the same live feed.
 *
 * `executeAsStep: false` tells the Agents SDK not to wrap the body in
 * `context.run` — `context.invoke` is already its own durable step.
 */
function buildSubagentTools(
  subagents: AgentDefinition[],
  context: WorkflowContext<AgentEnvelope<unknown>>,
  channel: string
): Record<string, Tool> {
  const entries = subagents.map((sub) => {
    const delegateTool = tool({
      description: `Delegate a task to the "${sub.name}" agent. ${sub.description}`,
      inputSchema: sub.inputSchema,
      execute: async (subInput) => {
        const { body } = await context.invoke(`invoke ${sub.name}`, {
          workflow: sub.workflow,
          body: { input: subInput, channel },
        });
        return body;
      },
    });
    // Run context.invoke directly instead of nesting it inside context.run.
    (delegateTool as Tool & { executeAsStep?: boolean }).executeAsStep = false;
    return [sub.name, delegateTool] as const;
  });
  return Object.fromEntries(entries);
}
