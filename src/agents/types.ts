import type { CoreTool, generateText } from "ai";
import type { Tool } from "langchain/tools";
import { Agent } from "./agent";

export type AISDKTool = CoreTool;
export type LangchainTool = Tool;

type GenerateTextParams = Parameters<typeof generateText>[0];

export type Model = GenerateTextParams["model"];

export type AgentParameters<TTool extends AISDKTool | LangchainTool = AISDKTool> = {
  maxSteps: number;
  background: string;
  tools: Record<string, TTool>;
  name: string;
  model: Model;
};

type TaskParams = {
  prompt: string;
};
export type SingleAgentTaskParams = TaskParams & {
  agent: Agent;
};
export type MultiAgentTaskParams = TaskParams & {
  agents: Agent[];
  maxSteps: number;
  model: Model;
  background?: string;
};
