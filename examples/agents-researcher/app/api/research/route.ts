import { serve } from '@upstash/workflow/nextjs';
import { LogLevel, Step, WorkflowLogger } from '@upstash/workflow';

import { Redis } from '@upstash/redis';

import { WikipediaQueryRun } from '@langchain/community/tools/wikipedia_query_run';
import { WolframAlphaTool } from '@langchain/community/tools/wolframalpha';
import { ExaSearchResults } from '@langchain/exa';
import Exa from 'exa-js';

const client = new Exa(process.env.EXASEARCH_API_KEY);

//@ts-expect-error since we had to redeclare the workflowRunId
class StepLogger extends WorkflowLogger {
  //@ts-expect-error since we had to redeclare the workflowRunId
  protected workflowRunId: string;

  constructor() {
    super({ logLevel: 'SUBMIT', logOutput: 'console' });
  }

  async log(
    level: LogLevel,
    eventType:
      | 'ERROR'
      | 'ENDPOINT_START'
      | 'SUBMIT_THIRD_PARTY_RESULT'
      | 'CREATE_CONTEXT'
      | 'SUBMIT_FIRST_INVOCATION'
      | 'RUN_SINGLE'
      | 'RUN_PARALLEL'
      | 'SUBMIT_STEP'
      | 'SUBMIT_CLEANUP'
      | 'RESPONSE_WORKFLOW'
      | 'RESPONSE_DEFAULT',
    details?: unknown
  ): Promise<void> {
    if (level === 'SUBMIT' && eventType === 'SUBMIT_STEP') {
      const _details = details as { length: number; steps: Step[] };
      if (_details.length === 1 && _details.steps.length === 1) {
        const step = _details.steps[0];
        const redis = Redis.fromEnv();
        await redis.set(`${this.workflowRunId}:progress`, step.stepName);
        if (step.stepName === 'Run tool wikiTool') {
          await redis.rpush(
            `${this.workflowRunId}:wikipediaOutput`,
            JSON.stringify({
              stepName: step.stepName,
              stepOut: step.out
            })
          );
        }
        if (step.stepName === 'Run tool wolframAlphaTool') {
          await redis.rpush(
            `${this.workflowRunId}:wolframAlphaOutput`,
            JSON.stringify({
              stepName: step.stepName,
              stepOut: step.out
            })
          );
        }
        if (step.stepName === 'Run tool searchWeb') {
          await redis.rpush(
            `${this.workflowRunId}:searchOutput`,
            JSON.stringify({
              stepName: step.stepName,
              stepOut:
                typeof step.out === 'string'
                  ? step.out
                  : JSON.stringify(step.out)
            })
          );
        }
      }
    }

    return;
  }
}

export const { POST } = serve(
  async (context) => {
    const model = context.agents.openai('gpt-4o-mini');
    const input = context.requestPayload;

    const wikipediaAgent = context.agents.agent({
      model,
      name: 'wikipediaAgent',
      maxSteps: 2,
      background:
        'You are an agent that can answer questions by querying Wikipedia ' +
        'and provide a summary of the answer with references to the next agent. ' +
        "If you can't get the answer from Wikipedia, return not found instead." +
        'Include one or more links to the Wikipedia article(s) you used as a reference if you can.',
      tools: {
        wikiTool: new WikipediaQueryRun({
          topKResults: 3,
          maxDocContentLength: 4000
        })
      }
    });

    const wolframAlphaAgent = context.agents.agent({
      model,
      name: 'wolframAlphaAgent',
      maxSteps: 2,
      background:
        'You are an agent that can answer questions by querying Wolfram Alpha, ' +
        'and provide a summary of the answer with references to the next agent. ' +
        "If you can't get the answer from Wolfram Alpha, return not found instead." +
        'Include one or more links to the Wolfram Alpha page(s) you used as a reference if you can.',
      tools: {
        wolframAlphaTool: new WolframAlphaTool({
          appid: process.env.WOLFRAM_ALPHA_APP_ID!
        })
      }
    });

    const searchAgent = context.agents.agent({
      model,
      name: 'searchAgent',
      maxSteps: 7,
      background:
        'You are an agent that can search the web using Exa. You must provide ' +
        'the user with a summary of the answer with references to the sources ' +
        "of information you used. If you can't find the answer, return not found " +
        'instead. Include one or more links to the web page(s) you used as a ' +
        'reference if you can.',
      tools: {
        searchWeb: new ExaSearchResults({
          client,
          searchArgs: {
            numResults: 3,
            type: 'keyword'
          }
        })
      }
    });

    const crossReferenceTask = context.agents.task({
      model,
      prompt:
        'You are an agent that takes input from other agents with access to different ' +
        'sources of information, and provide a summary of the answer with references. ' +
        'You must provide the user with an answer to their question with references to ' +
        'the sources of information you used. ' +
        'Include one or more links to the relevant pages you used as a reference if you can. ' +
        `Question: ${input}`,
      agents: [wikipediaAgent, wolframAlphaAgent, searchAgent],
      maxSteps: 3
    });

    const { text } = await crossReferenceTask.run();

    await context.run('Save Cross Reference Output', async () => {
      const redis = Redis.fromEnv();
      await redis.rpush(
        `${context.workflowRunId}:crossReferenceOutput`,
        JSON.stringify({
          stepName: 'Call Agent Manager LLM',
          stepOut: text
        })
      );
      return text;
    });
  },
  {
    verbose: new StepLogger() as unknown as WorkflowLogger
  }
);
