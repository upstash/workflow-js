import type { CoreTool, generateText } from "ai";
import { Agent } from "./agent";
import { WorkflowTool } from "./adapters";
import { CallSettings } from "../types";
import { createOpenAI } from "@ai-sdk/openai";

export type AISDKTool = CoreTool;
export type LangchainTool = {
  description: string;
  schema: AISDKTool["parameters"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (...params: any[]) => any;
};

type GenerateTextParams = Parameters<typeof generateText>[0];

export type Model = GenerateTextParams["model"];

export type AgentParameters<TTool extends AISDKTool | LangchainTool | WorkflowTool = AISDKTool> = {
  /**
   * number of times the agent can call the LLM at most. If
   * the agent abruptly stops execution after calling tools, you may need
   * to increase maxSteps
   */
  maxSteps: number;
  /**
   * Background of the agent
   */
  background: string;
  /**
   * tools available to the agent
   */
  tools: Record<string, TTool>;
  /**
   * Name of the agent
   */
  name: string;
  /**
   * LLM model to use
   */
  model: Model;
  /**
   * temparature used when calling the LLM
   *
   * @default 0.1
   */
  temparature?: number;
};

type TaskParams = {
  /**
   * task assigned to the agent
   */
  prompt: string;
};
export type SingleAgentTaskParams = TaskParams & {
  /**
   * agent to perform the task
   */
  agent: Agent;
};
export type MultiAgentTaskParams = TaskParams & {
  /**
   * Agents which will collaborate to achieve the task
   */
  agents: Agent[];
  /**
   * number of times the manager agent can call the LLM at most.
   * If the agent abruptly stops execution after calling other agents, you may
   * need to increase maxSteps
   */
  maxSteps: number;
  /**
   * LLM model to use
   */
  model: Model;
  /**
   * Background of the agent. If not passed, default will be used.
   */
  background?: string;
};

export type ManagerAgentParameters = {
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

type ModelParams = Parameters<ReturnType<typeof createOpenAI>>;
export type AgentCallParams = Pick<CallSettings, "flowControl" | "retries" | "timeout">;
type CustomModelSettings = ModelParams["1"] & { baseURL?: string; apiKey?: string } & {
  callSettings: AgentCallParams;
};
export type CustomModelParams = [ModelParams[0], CustomModelSettings?];

export type ProviderFunction = (params: {
  fetch: typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) => any;
