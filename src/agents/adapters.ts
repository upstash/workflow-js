/**
 * this file contains adapters which convert tools and models
 * to workflow tools and models.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { HTTPMethods } from "@upstash/qstash";
import { WorkflowContext } from "../context";
import { tool } from "ai";

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

        // Make network call
        const responseInfo = await context.call("call OpenAI", {
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

export const workflowTool = ({
  context,
  params,
}: {
  context: WorkflowContext;
  params: Parameters<typeof tool>[0];
}) => {
  const { execute, ...rest } = params;
  return tool({
    // @ts-expect-error can't resolve execute
    execute: (params: unknown) => context.run("run tool", () => execute(params)),
    ...rest,
  });
};
