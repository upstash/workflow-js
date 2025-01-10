/**
 * this file contains adapters which convert tools and models
 * to workflow tools and models.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { HTTPMethods } from "@upstash/qstash";
import { WorkflowContext } from "../context";
import { tool } from "ai";
import { AgentParameters } from "./agent";

export type ToolParams = Parameters<typeof tool>[0];

export const AGENT_NAME_HEADER = "upstash-agent-name";

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

export const wrapTools = ({
  context,
  tools,
}: {
  context: WorkflowContext;
  tools: AgentParameters["tools"];
}) => {
  return Object.fromEntries(
    Object.entries(tools).map((toolInfo) => {
      const [toolName, tool] = toolInfo;
      const execute = tool.execute;
      if (execute) {
        const wrappedExecute = (...params: Parameters<typeof execute>) => {
          return context.run(`Run tool ${toolName}`, () => execute(...params));
        };
        tool.execute = wrappedExecute;
      }

      return [toolName, tool];
    })
  );
};
