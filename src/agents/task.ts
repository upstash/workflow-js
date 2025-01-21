import { WorkflowContext } from "../context";
import { ManagerAgent } from "./agent";
import { MultiAgentTaskParams, SingleAgentTaskParams } from "./types";

/**
 * An Agent Task
 *
 * Can be run to make the agent(s) complete it using the tools available to them
 *
 * Can consist of a single agent or multiple agents.
 *
 * Single agent:
 *
 * ```ts
 * const task = context.agents.task({
 *   agent: researcherAgent,
 *   prompt: "Tell me about 5 topics in advanced physics.",
 * });
 * const { text } = await task.run();
 * ```
 *
 * Multi Agent:
 *
 * ```ts
 * const task = context.agents.task({
 *   model,
 *   maxSteps: 3,
 *   agents: [researcherAgent, mathAgent],
 *   prompt: "Tell me about 3 cities in Japan and calculate the sum of their populations",
 * });
 * const { text } = await task.run();
 * ```
 */
export class Task {
  private readonly context: WorkflowContext;
  private readonly taskParameters: SingleAgentTaskParams | MultiAgentTaskParams;

  constructor({
    context,
    taskParameters,
  }: {
    context: WorkflowContext;
    taskParameters: SingleAgentTaskParams | MultiAgentTaskParams;
  }) {
    this.context = context;
    this.taskParameters = taskParameters;
  }

  /**
   * Run the agents to complete the task
   *
   * @returns Result of the task as { text: string }
   */
  public async run(): Promise<{ text: string }> {
    const { prompt, ...otherParams } = this.taskParameters;

    if ("agent" in otherParams) {
      const agent = otherParams.agent;
      const result = await agent.call({
        prompt,
      });
      return { text: result.text };
    } else {
      const { agents, maxSteps, model, background } = otherParams;
      const managerAgent = new ManagerAgent(
        {
          model,
          maxSteps,
          agents,
          name: "Manager LLM",
          background,
        },
        this.context
      );

      const result = await managerAgent.call({ prompt });
      return { text: result.text };
    }
  }
}
