import type { CoreTool, generateText } from "ai";
import type { Tool } from "langchain/tools";

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
