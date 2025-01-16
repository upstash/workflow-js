import { WorkflowContext } from "../context";
import { createWorkflowOpenAI, wrapTools } from "./adapters";
import { Agent } from "./agent";
import { Task } from "./task";
import {
  AgentParameters,
  AISDKTool,
  LangchainTool,
  MultiAgentTaskParams,
  SingleAgentTaskParams,
} from "./types";

export { createWorkflowOpenAI } from "./adapters";
export { Agent } from "./agent";

export class WorkflowAgents {
  private context: WorkflowContext;
  constructor({ context }: { context: WorkflowContext }) {
    this.context = context;
  }

  public agent(params: AgentParameters<AISDKTool | LangchainTool>) {
    // wrap tools of agent with context.run
    const wrappedTools = wrapTools({ context: this.context, tools: params.tools });

    return new Agent({
      ...params,
      tools: wrappedTools,
    });
  }

  public task(taskParameters: SingleAgentTaskParams): Task;
  public task(taskParameters: MultiAgentTaskParams): Task;
  public task(taskParameters: SingleAgentTaskParams | MultiAgentTaskParams): Task {
    return new Task({ context: this.context, taskParameters });
  }

  public openai(...params: Parameters<ReturnType<typeof createWorkflowOpenAI>>) {
    const openai = createWorkflowOpenAI(this.context);
    return openai(...params);
  }
}
