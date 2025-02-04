import { serve } from "@upstash/workflow/nextjs";
import { LogLevel, Step, WorkflowLogger } from "@upstash/workflow";

import { tool } from "ai";
import { z } from "zod";

import { Redis } from "@upstash/redis";

import { WikipediaQueryRun } from "@langchain/community/tools/wikipedia_query_run";
import { WolframAlphaTool } from "@langchain/community/tools/wolframalpha";
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";

import * as cheerio from "cheerio";

//@ts-expect-error since we had to redeclare the workflowRunId
class StepLogger extends WorkflowLogger {
  //@ts-expect-error since we had to redeclare the workflowRunId
  protected workflowRunId: string;
  constructor() {
    super({ logLevel: "SUBMIT", logOutput: "console" });
  }
  async log(
    level: LogLevel,
    eventType:
      | "ERROR"
      | "ENDPOINT_START"
      | "SUBMIT_THIRD_PARTY_RESULT"
      | "CREATE_CONTEXT"
      | "SUBMIT_FIRST_INVOCATION"
      | "RUN_SINGLE"
      | "RUN_PARALLEL"
      | "SUBMIT_STEP"
      | "SUBMIT_CLEANUP"
      | "RESPONSE_WORKFLOW"
      | "RESPONSE_DEFAULT",
    details?: unknown
  ): Promise<void> {
    if (level === "SUBMIT" && eventType === "SUBMIT_STEP") {
      const _details = details as { length: number; steps: Step[] };
      if (_details.length === 1 && _details.steps.length === 1) {
        const step = _details.steps[0];
        if (step.stepName === "Run tool wikiTool") {
          const redis = Redis.fromEnv();
          await redis.set(`${this.workflowRunId}:wikipediaOutput`, step.out);
        }
        if (step.stepName === "Run tool wolframAlphaTool") {
          const redis = Redis.fromEnv();
          await redis.set(`${this.workflowRunId}:wolframAlphaOutput`, step.out);
        }
        if (
          step.stepName === "Run tool searchWeb" ||
          step.stepName === "Run tool browseWeb"
        ) {
          const redis = Redis.fromEnv();
          await redis.append(
            `${this.workflowRunId}:searchOutput`,
            typeof step.out === "string" ? step.out : JSON.stringify(step.out)
          );
        }
      }
    }

    return;
  }
}

export const { POST } = serve(
  async (context) => {
    const model = context.agents.openai("gpt-4o-mini");
    const input = context.requestPayload;

    const wikipediaAgent = context.agents.agent({
      model,
      name: "wikipediaAgent",
      maxSteps: 2,
      background:
        "You are an agent that can answer questions by querying Wikipedia " +
        "and provide a summary of the answer with references to the next agent. " +
        "If you can't get the answer from Wikipedia, return not found instead." +
        "Include one or more links to the Wikipedia article(s) you used as a reference if you can.",
      tools: {
        wikiTool: new WikipediaQueryRun({
          topKResults: 3,
          maxDocContentLength: 4000,
        }),
      },
    });

    const wolframAlphaAgent = context.agents.agent({
      model,
      name: "wolframAlphaAgent",
      maxSteps: 2,
      background:
        "You are an agent that can answer questions by querying Wolfram Alpha, " +
        "and provide a summary of the answer with references to the next agent. " +
        "If you can't get the answer from Wolfram Alpha, return not found instead." +
        "Include one or more links to the Wolfram Alpha page(s) you used as a reference if you can.",
      tools: {
        wolframAlphaTool: new WolframAlphaTool({
          appid: process.env.WOLFRAM_ALPHA_APP_ID!,
        }),
      },
    });

    const searchAgent = context.agents.agent({
      model,
      name: "searchAgent",
      maxSteps: 7,
      background:
        "You are an agent that can search the web using DuckDuckGo and scrape content " +
        "from a webpage. You must provide the user with a summary of " +
        "the answer with references to the sources of information you used. If you can't " +
        "find the answer, return not found instead. " +
        "Include one or more links to the web page(s) you used as a reference if you can.",
      tools: {
        searchWeb: new DuckDuckGoSearch({ maxResults: 3 }),
        browseWeb: tool({
          description: "Get the content of a webpage.",
          parameters: z.object({
            url: z
              .string()
              .describe(
                "Valid URL including protocol of the webpage you want to scrape content from."
              ),
          }),
          execute: async ({ url }) => {
            const html = await fetch(url).then((res) => res.text());

            const $ = cheerio.load(html);

            const selectorsToRemove = [
              "script",
              "style",
              "header",
              "footer",
              "nav",
              "iframe",
              "noscript",
              "svg",
              '[role="banner"]',
              '[role="navigation"]',
              '[role="complementary"]',
              ".ad",
              ".advertisement",
              ".social-share",
              "aside",
              ".sidebar",
              "#sidebar",
              ".comments",
              "#comments",
            ];

            selectorsToRemove.forEach((selector) => {
              $(selector).remove();
            });

            let $content = $('main, article, [role="main"]');

            if (!$content.length) {
              $content = $("body");
            }

            let content = $content.text();

            content = content
              .replace(/\s+/g, " ")
              .replace(/\n\s*/g, "\n")
              .trim();
            return content;
          },
        }),
      },
    });

    const crossReferenceTask = context.agents.task({
      model,
      prompt:
        "You are an agent that takes input from other agents with access to different " +
        "sources of information, and provide a summary of the answer with references. " +
        "You must provide the user with an answer to their question with references to " +
        "the sources of information you used. " +
        "Include one or more links to the relevant pages you used as a reference if you can. " +
        `Question: ${input}`,
      agents: [wikipediaAgent, wolframAlphaAgent, searchAgent],
      maxSteps: 3,
    });

    const { text } = await crossReferenceTask.run();

    await context.run("save-cross-reference-output", async () => {
      const redis = Redis.fromEnv();
      await redis.set(`${context.workflowRunId}:crossReferenceOutput`, text);
      return text;
    });
  },
  {
    verbose: new StepLogger() as unknown as WorkflowLogger,
  }
);
