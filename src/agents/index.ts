import { WorkflowContext } from "../context";
import { createWorkflowOpenAI, wrapTools } from "./adapters";
import { Agent, AgentParameters, ManagerAgent, Model } from "./agent";

export { createWorkflowOpenAI } from "./adapters";
export { Agent, ManagerAgent } from "./agent";

type TaskParams = {
  prompt: string;
};
type SingleAgentTaskParams = TaskParams & {
  agent: Agent;
};
type MultiAgentTaskParams = TaskParams & {
  agents: Agent[];
  maxSteps: number;
  model: Model;
  background?: string;
};

export class WorkflowAgents {
  private context: WorkflowContext;
  constructor({ context }: { context: WorkflowContext }) {
    this.context = context;
  }

  public agent(params: AgentParameters) {
    // wrap tools of agent with context.run
    const wrappedTools = wrapTools({ context: this.context, tools: params.tools });

    return new Agent({
      ...params,
      tools: wrappedTools,
    });
  }

  public async task(params: SingleAgentTaskParams): Promise<string>;
  public async task(params: MultiAgentTaskParams): Promise<string>;
  public async task(params: SingleAgentTaskParams | MultiAgentTaskParams): Promise<string> {
    const { prompt, ...otherParams } = params;
    if ("agent" in otherParams) {
      const agent = otherParams.agent;
      const result = await agent.call({
        prompt,
      });
      return result.text;
    } else {
      const { agents, maxSteps, model, background } = otherParams;
      const managerAgent = new ManagerAgent({
        model,
        maxSteps,
        agents,
        name: "manager llm",
        background,
      });

      const result = await managerAgent.call({ prompt });
      return result.text;
    }
  }

  public getOpenai() {
    return createWorkflowOpenAI(this.context);
  }
}
