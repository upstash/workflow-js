import { WorkflowContext } from "../context";
import { ManagerAgent } from "./agent";
import { MultiAgentTaskParams, SingleAgentTaskParams } from "./types";

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

  public async run(): Promise<{ text: string }> {
    const { prompt, ...otherParams } = this.taskParameters;

    // during context.call execution, prompt may become undefined if it's derived from
    // context.requestPayload. generateText will throw in this case. Put a context.run
    // to guard against this.
    const safePrompt = await this.context.run("Get Prompt", () => prompt);

    if ("agent" in otherParams) {
      const agent = otherParams.agent;
      const result = await agent.call({
        prompt: safePrompt,
      });
      return { text: result.text };
    } else {
      const { agents, maxSteps, model, background } = otherParams;
      const managerAgent = new ManagerAgent({
        model,
        maxSteps,
        agents,
        name: "Manager LLM",
        background,
      });

      const result = await managerAgent.call({ prompt: safePrompt });
      return { text: result.text };
    }
  }
}
