import { z } from "zod";
import { AGENT_NAME_HEADER } from "./adapters";

import { generateText, tool, ToolExecutionError } from "ai";
import { AgentParameters, AISDKTool, Model } from "./types";

/**
 * An Agent which utilizes the model and tools available to it
 * to achieve a given task
 *
 * @param name Name of the agent
 * @param background Background of the agent
 * @param model LLM model to use
 * @param tools tools available to the agent
 * @param maxSteps number of times the agent can call the LLM at most. If
 *   the agent abruptly stops execution after calling tools, you may need
 *   to increase maxSteps
 * @param temparature temparature used when calling the LLM
 */
export class Agent {
  public readonly name: AgentParameters["name"];
  public readonly tools: AgentParameters["tools"];
  public readonly maxSteps: AgentParameters["maxSteps"];
  public readonly background: AgentParameters["background"];
  public readonly model: AgentParameters["model"];
  public readonly temparature: AgentParameters["temparature"];

  constructor({ tools, maxSteps, background, name, model, temparature = 0.1 }: AgentParameters) {
    this.name = name;
    this.tools = tools ?? {};
    this.maxSteps = maxSteps;
    this.background = background;
    this.model = model;
    this.temparature = temparature;
  }

  /**
   * Trigger the agent by passing a prompt
   *
   * @param prompt task to assign to the agent
   * @returns Response as `{ text: string }`
   */
  public async call({ prompt }: { prompt: string }) {
    try {
      const result = await generateText({
        model: this.model,
        tools: this.tools,
        maxSteps: this.maxSteps,
        system: this.background,
        prompt,
        headers: {
          [AGENT_NAME_HEADER]: this.name,
        },
        temperature: this.temparature,
      });
      return { text: result.text };
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        if (error.cause instanceof Error && error.cause.name === "WorkflowAbort") {
          throw error.cause;
        } else if (
          error.cause instanceof ToolExecutionError &&
          error.cause.cause instanceof Error &&
          error.cause.cause.name === "WorkflowAbort"
        ) {
          throw error.cause.cause;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Convert the agent to a tool which can be used by other agents.
   *
   * @returns the agent as a tool
   */
  public asTool(): AISDKTool {
    const toolDescriptions = Object.values(this.tools)
      // @ts-expect-error description exists but can't be resolved
      .map((tool) => tool.description)
      .join("\n");
    return tool({
      parameters: z.object({ prompt: z.string() }),
      execute: async ({ prompt }) => {
        return await this.call({ prompt });
      },
      description:
        `An AI Agent with the following background: ${this.background}` +
        `Has access to the following tools: ${toolDescriptions}`,
    });
  }
}

type ManagerAgentParameters = {
  /**
   * agents which will coordinate to achieve a given task
   */
  agents: Agent[];
  /**
   * model to use when coordinating the agents
   */
  model: Model;
} & Pick<Partial<AgentParameters>, "name" | "background"> &
  Pick<AgentParameters, "maxSteps">;

const MANAGER_AGENT_PROMPT = `You are an agent orchestrating other AI Agents.

These other agents have tools available to them.

Given a prompt, utilize these agents to address requests.

Don't always call all the agents provided to you at the same time. You can call one and use it's response to call another.

Avoid calling the same agent twice in one turn. Instead, prefer to call it once but provide everything
you need from that agent.
`;

export class ManagerAgent extends Agent {
  public agents: ManagerAgentParameters["agents"];

  /**
   * A manager agent which coordinates agents available to it to achieve a
   * given task
   *
   * @param name Name of the agent
   * @param background Background of the agent. If not passed, default will be used.
   * @param model LLM model to use
   * @param agents: List of agents available to the agent
   * @param maxSteps number of times the manager agent can call the LLM at most.
   *   If the agent abruptly stops execution after calling other agents, you may
   *   need to increase maxSteps
   */
  constructor({
    agents,
    background = MANAGER_AGENT_PROMPT,
    model,
    maxSteps,
    name = "manager llm",
  }: ManagerAgentParameters) {
    super({
      background,
      maxSteps,
      tools: Object.fromEntries(agents.map((agent) => [agent.name, agent.asTool()])),
      name,
      model,
    });
    this.agents = agents;
  }
}
