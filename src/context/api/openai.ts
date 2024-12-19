import { openai } from "@upstash/qstash";
import { ApiCallSettings, BaseWorkflowApi } from "./base";
import { CallResponse } from "../../types";

type Messages =
  | {
      content: string;
      role: "developer" | "system";
      name?: string;
    }
  | {
      content: unknown;
      role: "user";
      name?: string;
    }
  | {
      content: unknown;
      refusal?: string;
      role: "assistant";
      name?: string;
      audio?: unknown;
      tool_calls?: unknown;
    }
  | {
      role: "tool";
      content: string | unknown;
      tool_call_id: string;
    }
  | {
      role: "function";
      content: string | undefined;
      name: string;
    };

type CreateChatCompletion = {
  messages: Messages[];
  model: string;
  store?: boolean;
  reasoning_effort?: string;
  metadata?: unknown;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  max_completion_tokens?: number;
  n?: number;
  modalities?: string[];
  prediction?: unknown;
  audio?: unknown;
  presence_penalty?: number;
  response_format?: unknown;
  seed?: number;
  service_tier?: string;
  stop?: string | string[];
  /**
   * streaming is not supported in Upstash Workflow.
   */
  stream?: false;
  temperature?: number;
  top_p?: number;
  tools?: unknown;
  tool_choice?: string;
  parallel_tool_calls?: boolean;
  user?: string;
};

type ChatCompletion = {
  id: string;
  choices: ChatCompletionChoice[];
  created: number;
  model: string;
  object: "chat.completion";
  service_tier?: "scale" | "default" | null;
  system_fingerprint?: string;
  usage?: unknown;
};

type ChatCompletionChoice = {
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call";
  index: number;
  logprobs: unknown;
  message: {
    content: string | null;
    refusal: string | null;
    role: "assistant";
    audio?: unknown;
    tool_calls?: unknown;
  };
};

export class OpenAIAPI extends BaseWorkflowApi {
  public async call<TBody = CreateChatCompletion, TResponse = ChatCompletion>(
    stepName: string,
    settings: ApiCallSettings<
      TBody,
      {
        token: string;
        organization?: string;
        operation: "chat.completions.create";
      }
    >
  ): Promise<CallResponse<TResponse>> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token, organization, operation, ...parameters } = settings;
    return await this.callApi<TResponse>(stepName, {
      api: {
        name: "llm",
        provider: openai({ token, organization }),
      },
      ...parameters,
    });
  }
}
