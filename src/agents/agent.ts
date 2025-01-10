import { CoreTool, generateText, tool, ToolExecutionError } from "ai";
import { z } from "zod";
import { AGENT_NAME_HEADER } from "./adapters";

type GenerateTextParams = Parameters<typeof generateText>[0];
export type Model = GenerateTextParams["model"];
export type AgentParameters = {
  maxSteps: number;
  background: string;
  tools: Record<string, CoreTool>;
  name: string;
  model: Model;
};

export class Agent {
  public readonly name: AgentParameters["name"];
  public readonly tools: Required<AgentParameters["tools"]>;
  public readonly maxSteps: AgentParameters["maxSteps"];
  public readonly background: AgentParameters["background"];
  public readonly model: AgentParameters["model"];

  constructor({ tools, maxSteps, background, name, model }: AgentParameters) {
    this.name = name;
    this.tools = tools ?? {};
    this.maxSteps = maxSteps;
    this.background = background;
    this.model = model;
  }

  public async call({ prompt }: { prompt: string }) {
    try {
      return await generateText({
        model: this.model,
        tools: this.tools,
        maxSteps: this.maxSteps,
        system: this.background,
        prompt,
        headers: {
          [AGENT_NAME_HEADER]: this.name,
        },
      });
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

  public asTool(): CoreTool {
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
  agents: Agent[];
  model: Model;
} & Pick<Partial<AgentParameters>, "name" | "background"> &
  Pick<AgentParameters, "maxSteps">;

const MANAGER_AGENT_PROMPT = `You are an AI agent who orchestrates other AI Agents.
These other agents have tools available to them.
Given a prompt, utilize these agents to address requests.
Don't always call all the agents provided to you at the same time. You can call one and use it's response to call another. 
`;

export class ManagerAgent extends Agent {
  public agents: ManagerAgentParameters["agents"];
  constructor({
    maxSteps,
    background = MANAGER_AGENT_PROMPT,
    agents,
    model,
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
