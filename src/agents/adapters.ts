/**
 * this file contains adapters which convert tools and models
 * to workflow tools and models.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { HTTPMethods } from "@upstash/qstash";
import { WorkflowContext } from "../context";
import { tool } from "ai";
import { AISDKTool, LangchainTool } from "./types";
import { AGENT_NAME_HEADER } from "./constants";

/**
 * creates an AI SDK openai client with a custom
 * fetch implementation which uses context.call.
 *
 * @param context workflow context
 * @returns ai sdk openai
 */
export const createWorkflowOpenAI = (context: WorkflowContext) => {
  return createOpenAI({
    compatibility: "strict",
    fetch: async (input, init) => {
      try {
        // Prepare headers from init.headers
        const headers = init?.headers
          ? Object.fromEntries(new Headers(init.headers).entries())
          : {};

        // Prepare body from init.body
        const body = init?.body ? JSON.parse(init.body as string) : undefined;

        // create step name
        const agentName = headers[AGENT_NAME_HEADER] as string | undefined;
        const stepName = agentName ? `Call Agent ${agentName}` : "Call Agent";

        // Make network call
        const responseInfo = await context.call(stepName, {
          url: input.toString(),
          method: init?.method as HTTPMethods,
          headers,
          body,
        });

        // Construct headers for the response
        const responseHeaders = new Headers(
          Object.entries(responseInfo.header).reduce(
            (acc, [key, values]) => {
              acc[key] = values.join(", ");
              return acc;
            },
            {} as Record<string, string>
          )
        );

        // Return the constructed response
        return new Response(JSON.stringify(responseInfo.body), {
          status: responseInfo.status,
          headers: responseHeaders,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "WorkflowAbort") {
          throw error;
        } else {
          console.error("Error in fetch implementation:", error);
          throw error; // Rethrow error for further handling
        }
      }
    },
  });
};

/**
 * converts LangChain tools to AI SDK tools and updates
 * the execute method of these tools by wrapping it with
 * context.run.
 *
 * @param context workflow context
 * @param tools map of AI SDK or LangChain tools and their names
 * @returns
 */
export const wrapTools = ({
  context,
  tools,
}: {
  context: WorkflowContext;
  tools: Record<string, AISDKTool | LangchainTool>;
}): Record<string, AISDKTool> => {
  return Object.fromEntries(
    Object.entries(tools).map((toolInfo) => {
      const [toolName, tool] = toolInfo;
      const aiSDKTool: AISDKTool = convertToAISDKTool(tool);

      const execute = aiSDKTool.execute;
      if (execute) {
        const wrappedExecute = (...params: Parameters<typeof execute>) => {
          return context.run(`Run tool ${toolName}`, () => execute(...params));
        };
        aiSDKTool.execute = wrappedExecute;
      }

      return [toolName, aiSDKTool];
    })
  );
};

/**
 * Converts tools to AI SDK tool if it already isn't
 *
 * @param tool LangChain or AI SDK Tool
 * @returns AI SDK Tool
 */
const convertToAISDKTool = (tool: AISDKTool | LangchainTool): AISDKTool => {
  const isLangchainTool = "invoke" in tool;
  return isLangchainTool ? convertLangchainTool(tool as LangchainTool) : (tool as AISDKTool);
};

/**
 * converts a langchain tool to AI SDK tool
 *
 * @param langchainTool
 * @returns AI SDK Tool
 */
const convertLangchainTool = (langchainTool: LangchainTool): AISDKTool => {
  return tool({
    description: langchainTool.description,
    parameters: langchainTool.schema,
    execute: async (...param: unknown[]) => langchainTool.invoke(...param),
  });
};
