import { anthropic } from "@upstash/qstash";
import { ApiCallSettings, BaseWorkflowApi } from "./base";
import { CallResponse } from "../../types";

type CreateChatCompletion = {
  model: string;
  messages: { role: "user" | "assistant"; content: unknown }[];
  max_tokens: number;
  metadata?: object;
  stop_sequences?: string[];
  /**
   * streaming is not possible Upstash Workflow.
   */
  stream?: false;
  system?: string;
  temparature?: number;
  top_k?: number;
  top_p?: number;
};

type ChatCompletion = {
  id: string;
  type: "message";
  role: "assistant";
  content: { type: "text"; text: string }[];
  model: string;
  stop_reasong: string;
  stop_sequence: string[];
  usage: unknown;
};

export class AnthropicAPI extends BaseWorkflowApi {
  public async call<TBody = CreateChatCompletion, TResponse = ChatCompletion>(
    stepName: string,
    settings: ApiCallSettings<
      TBody,
      {
        token: string;
        operation: "messages.create";
      }
    >
  ): Promise<CallResponse<TResponse>> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token, operation, ...parameters } = settings;
    return await this.callApi<TResponse>(stepName, {
      api: {
        name: "llm",
        provider: anthropic({ token }),
      },
      ...parameters,
    });
  }
}
