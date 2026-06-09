import { z } from "zod";
import { defineAgent } from "./_sdk/define-agent";
import { serveAgents } from "./_sdk/serve-agents";

/**
 * The whole "application" using the agent SDK lives here: a few `defineAgent`
 * calls and a single `serveAgents`. Everything else (durable execution,
 * delegation, live logging) is handled by the SDK.
 */

const researcher = defineAgent({
  name: "researcher",
  description: "Gathers key facts and talking points about a topic.",
  input: z.object({ topic: z.string() }),
  prompt: ({ topic }) =>
    `Research "${topic}". Produce 4-6 concise, factual bullet points a writer could build on.`,
  background:
    "You are a thorough research assistant. First log your plan, then produce " +
    "tight, factual bullet points. No fluff, no invented facts.",
});

const writer = defineAgent({
  name: "writer",
  description: "Turns research notes into a short, polished piece of prose.",
  input: z.object({ brief: z.string() }),
  prompt: ({ brief }) =>
    `Using these notes, write a clear, engaging two-paragraph summary:\n\n${brief}`,
  background:
    "You are a skilled writer. Log what you're doing, then turn the notes into " +
    "clean, engaging prose. Do not invent facts beyond the notes.",
});

const orchestrator = defineAgent({
  name: "orchestrator",
  description: "Coordinates research and writing to answer a request end to end.",
  input: z.object({ request: z.string() }),
  prompt: ({ request }) => request,
  background:
    "You are an editor-in-chief coordinating a small team. " +
    "First log a one-line plan. Then call the `researcher` tool to gather facts " +
    "about the user's request, then call the `writer` tool with those facts. " +
    "Finally, reply with the writer's text VERBATIM as your final message — " +
    "output the full prose itself, do not summarize it or just say it is done.",
  maxSteps: 6,
  subagents: [researcher, writer],
});

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const { POST, trigger } = serveAgents({
  baseUrl: `${appUrl}/api/agents`,
  agents: [orchestrator, researcher, writer],
});
