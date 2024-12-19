import { AnthropicAPI } from "./anthropic";
import { BaseWorkflowApi } from "./base";
import { OpenAIAPI } from "./openai";
import { ResendAPI } from "./resend";

export class WorkflowApi extends BaseWorkflowApi {
  public get openai() {
    return new OpenAIAPI({
      context: this.context,
    });
  }

  public get resend() {
    return new ResendAPI({
      context: this.context,
    });
  }

  public get anthropic() {
    return new AnthropicAPI({
      context: this.context,
    });
  }
}
