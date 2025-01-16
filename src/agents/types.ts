import type { CoreTool, generateText } from "ai";
import { Agent } from "./agent";

export type AISDKTool = CoreTool;
export type LangchainTool = {
  description: string;
  schema: AISDKTool["parameters"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (...params: any[]) => any;
};

type GenerateTextParams = Parameters<typeof generateText>[0];

export type Model = GenerateTextParams["model"];

export type AgentParameters<TTool extends AISDKTool | LangchainTool = AISDKTool> = {
  maxSteps: number;
  background: string;
  tools: Record<string, TTool>;
  name: string;
  model: Model;
  temparature?: number;
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
