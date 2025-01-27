import { WorkflowContext } from "../context";
import { createWorkflowOpenAI, wrapTools } from "./adapters";
import { Agent } from "./agent";
import { Task } from "./task";
import {
  AgentParameters,
  AISDKTool,
  CustomModelParams,
  LangchainTool,
  MultiAgentTaskParams,
  SingleAgentTaskParams,
} from "./types";

/**
 * Workflow Agents API
 *
 * https://upstash.com/docs/workflow/agents/overview
 *
 * Allows defining agents which can complete a given task
 * using tools available to them.
 */
export class WorkflowAgents {
  private context: WorkflowContext;
  constructor({ context }: { context: WorkflowContext }) {
    this.context = context;
  }

  /**
   * Defines an agent
   *
   * ```ts
   * const researcherAgent = context.agents.agent({
   *   model,
   *   name: 'academic',
   *   maxSteps: 2,
   *   tools: {
   *     wikiTool: new WikipediaQueryRun({
   *       topKResults: 1,
   *       maxDocContentLength: 500,
   *     })
   *   },
   *   background:
   *     'You are researcher agent with access to Wikipedia. ' +
   *     'Utilize Wikipedia as much as possible for correct information',
   * });
   * ```
   *
   * @param params agent parameters
   * @returns
   */
  public agent(params: AgentParameters<AISDKTool | LangchainTool>) {
    // wrap tools of agent with context.run
    const wrappedTools = wrapTools({ context: this.context, tools: params.tools });

    return new Agent(
      {
        ...params,
        tools: wrappedTools,
      },
      this.context
    );
  }

  /**
   * Defines a task to be executed by a single agent
   *
   * ```ts
   * const task = context.agents.task({
   *   agent: researcherAgent,
   *   prompt: "Tell me about 5 topics in advanced physics.",
   * });
   * ```
   */
  public task(taskParameters: SingleAgentTaskParams): Task;
  /**
   * Defines a task to be executed by multiple collaborating agents
   *
   * ```ts
   * const task = context.agents.task({
   *  model,
   *  maxSteps: 3,
   *  agents: [researcherAgent, mathAgent],
   *  prompt: "Tell me about 3 cities in Japan and calculate the sum of their populations",
   * });
   * ```
   */
  public task(taskParameters: MultiAgentTaskParams): Task;
  public task(taskParameters: SingleAgentTaskParams | MultiAgentTaskParams): Task {
    return new Task({ context: this.context, taskParameters });
  }

  /**
   * creates an openai model for agents
   */
  public openai(...params: CustomModelParams) {
    const [model, settings] = params;
    const { baseURL, apiKey, ...otherSettings } = settings ?? {};
    const openai = createWorkflowOpenAI(this.context, { baseURL, apiKey });
    return openai(model, otherSettings);
  }
}
