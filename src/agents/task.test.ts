import { describe, test, expect, beforeEach } from "bun:test";
import { getWorkflowRunId, nanoid } from "../utils";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowAgents } from ".";
import { tool } from "ai";
import { z } from "zod";
import { DisabledWorkflowContext } from "../serve/authorization";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export const getAgentsApi = ({
  disabledContext,
  getModel,
}: {
  disabledContext: boolean;
  getModel?: (
    agentsApi: WorkflowAgents,
    context: WorkflowContext
  ) => ReturnType<typeof agentsApi.openai>;
}) => {
  const workflowRunId = getWorkflowRunId();
  const token = nanoid();

  let context: WorkflowContext;
  if (disabledContext) {
    context = new DisabledWorkflowContext({
      headers: new Headers({}) as Headers,
      initialPayload: "mock",
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
      steps: [{ stepId: 0, stepName: "init", concurrent: 1, stepType: "Initial" }],
      url: WORKFLOW_ENDPOINT,
      workflowRunId,
    });
  } else {
    context = new WorkflowContext({
      headers: new Headers({}) as Headers,
      initialPayload: "mock",
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
      steps: [{ stepId: 0, stepName: "init", concurrent: 1, stepType: "Initial" }],
      url: WORKFLOW_ENDPOINT,
      workflowRunId,
    });
  }

  const agentsApi = new WorkflowAgents({ context });

  const background = "an agent";
  const maxSteps = 2;
  const name = "my agent";
  const temparature = 0.4;
  const model = getModel ? getModel(agentsApi, context) : agentsApi.openai("gpt-3.5-turbo");

  const agent = agentsApi.agent({
    tools: {
      tool: tool({
        description: "ai sdk tool",
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => expression,
      }),
    },
    background,
    maxSteps,
    name,
    model,
    temparature,
  });

  return {
    agent,
    token,
    workflowRunId,
    context,
    agentsApi,
    model,
  };
};

describe("tasks", () => {
  const openaiToken = nanoid();
  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = openaiToken;
  });

  test("single agent", async () => {
    const { agentsApi, agent, token, workflowRunId } = getAgentsApi({ disabledContext: false });
    const task = agentsApi.task({
      agent,
      prompt: "hello world!",
    });

    await mockQStashServer({
      execute: () => {
        const throws = () => task.run();
        expect(throws).toThrowError(`Aborting workflow after executing step 'Call Agent my agent'`);
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            body: '{"model":"gpt-3.5-turbo","temperature":0.4,"messages":[{"role":"system","content":"an agent"},{"role":"user","content":"hello world!"}],"tools":[{"type":"function","function":{"name":"tool","description":"ai sdk tool","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
            destination: "https://api.openai.com/v1/chat/completions",
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-callback": "https://requestcatcher.com/api",
              "upstash-callback-feature-set": "LazyFetch,InitialBody",
              "upstash-callback-forward-upstash-workflow-callback": "true",
              "upstash-callback-forward-upstash-workflow-concurrent": "1",
              "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
              "upstash-callback-forward-upstash-workflow-stepid": "1",
              "upstash-callback-forward-upstash-workflow-stepname": "Call Agent my agent",
              "upstash-callback-forward-upstash-workflow-steptype": "Call",
              "upstash-callback-forward-upstash-workflow-invoke-count": "0",
              "upstash-callback-retries": "3",
              "upstash-callback-workflow-calltype": "fromCallback",
              "upstash-callback-workflow-init": "false",
              "upstash-callback-workflow-runid": workflowRunId,
              "upstash-callback-workflow-url": "https://requestcatcher.com/api",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "WF_NoDelete,InitialBody",
              "upstash-forward-authorization": `Bearer ${openaiToken}`,
              "upstash-forward-content-type": "application/json",
              "upstash-forward-upstash-agent-name": "my agent",
              "upstash-method": "POST",
              "upstash-retries": "0",
              "upstash-workflow-calltype": "toCallback",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  });

  test("multi agent with baseURL", async () => {
    const customApiKey = nanoid();
    const { agentsApi, agent, token, workflowRunId, model } = getAgentsApi({
      disabledContext: false,
      getModel(agentsApi, context) {
        const model = agentsApi.AISDKModel({
          context,
          provider: createOpenAI,
          providerParams: {
            baseURL: "https://api.deepseek.com/v1",
            apiKey: customApiKey,
          },
        });

        return model("gpt-4o", {
          reasoningEffort: "low",
        });
      },
    });

    const task = agentsApi.task({
      agents: [agent],
      model: model,
      maxSteps: 2,
      prompt: "hello world!",
    });

    await mockQStashServer({
      execute: () => {
        const throws = () => task.run();
        expect(throws).toThrowError(
          `Aborting workflow after executing step 'Call Agent Manager LLM'`
        );
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            body: '{"model":"gpt-4o","temperature":0.1,"reasoning_effort":"low","messages":[{"role":"system","content":"You are an agent orchestrating other AI Agents.\\n\\nThese other agents have tools available to them.\\n\\nGiven a prompt, utilize these agents to address requests.\\n\\nDon\'t always call all the agents provided to you at the same time. You can call one and use it\'s response to call another.\\n\\nAvoid calling the same agent twice in one turn. Instead, prefer to call it once but provide everything\\nyou need from that agent.\\n"},{"role":"user","content":"hello world!"}],"tools":[{"type":"function","function":{"name":"my agent","description":"An AI Agent with the following background: an agentHas access to the following tools: ai sdk tool","parameters":{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
            destination: "https://api.deepseek.com/v1/chat/completions",
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-callback": "https://requestcatcher.com/api",
              "upstash-callback-feature-set": "LazyFetch,InitialBody",
              "upstash-callback-forward-upstash-workflow-callback": "true",
              "upstash-callback-forward-upstash-workflow-concurrent": "1",
              "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
              "upstash-callback-forward-upstash-workflow-stepid": "1",
              "upstash-callback-forward-upstash-workflow-stepname": "Call Agent Manager LLM",
              "upstash-callback-forward-upstash-workflow-steptype": "Call",
              "upstash-callback-forward-upstash-workflow-invoke-count": "0",
              "upstash-callback-retries": "3",
              "upstash-callback-workflow-calltype": "fromCallback",
              "upstash-callback-workflow-init": "false",
              "upstash-callback-workflow-runid": workflowRunId,
              "upstash-callback-workflow-url": "https://requestcatcher.com/api",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "WF_NoDelete,InitialBody",
              "upstash-forward-authorization": `Bearer ${customApiKey}`,
              "upstash-forward-content-type": "application/json",
              "upstash-forward-upstash-agent-name": "Manager LLM",
              "upstash-method": "POST",
              "upstash-retries": "0",
              "upstash-workflow-calltype": "toCallback",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  });

  test("anthropic model", async () => {
    const { agentsApi, agent, token, workflowRunId } = getAgentsApi({
      disabledContext: false,
      getModel: (agentsApi, context) => {
        const model = agentsApi.AISDKModel({
          context,
          provider: createAnthropic,
          providerParams: {
            apiKey: "antrhopic-key",
          },
        });

        return model("claude-3-sonnet-20240229");
      },
    });

    const task = agentsApi.task({
      agent,
      prompt: "hello world!",
    });

    await mockQStashServer({
      execute: () => {
        const throws = () => task.run();
        expect(throws).toThrowError(`Aborting workflow after executing step 'Call Agent my agent'`);
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            body: '{"model":"claude-3-sonnet-20240229","max_tokens":4096,"temperature":0.4,"system":[{"type":"text","text":"an agent"}],"messages":[{"role":"user","content":[{"type":"text","text":"hello world!"}]}],"tools":[{"name":"tool","description":"ai sdk tool","input_schema":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}],"tool_choice":{"type":"auto"}}',
            destination: "https://api.anthropic.com/v1/messages",
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-callback": "https://requestcatcher.com/api",
              "upstash-callback-feature-set": "LazyFetch,InitialBody",
              "upstash-callback-forward-upstash-workflow-callback": "true",
              "upstash-callback-forward-upstash-workflow-concurrent": "1",
              "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
              "upstash-callback-forward-upstash-workflow-stepid": "1",
              "upstash-callback-forward-upstash-workflow-steptype": "Call",
              "upstash-callback-forward-upstash-workflow-invoke-count": "0",
              "upstash-callback-retries": "3",
              "upstash-callback-workflow-calltype": "fromCallback",
              "upstash-callback-workflow-init": "false",
              "upstash-callback-workflow-runid": workflowRunId,
              "upstash-callback-workflow-url": "https://requestcatcher.com/api",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "WF_NoDelete,InitialBody",
              "upstash-forward-content-type": "application/json",
              "upstash-forward-upstash-agent-name": "my agent",
              "upstash-method": "POST",
              "upstash-retries": "0",
              "upstash-workflow-calltype": "toCallback",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
              "upstash-callback-forward-upstash-workflow-stepname": "Call Agent my agent",
              // anthropic specific headers:
              "upstash-forward-x-api-key": "antrhopic-key",
              "upstash-forward-anthropic-version": "2023-06-01",
            },
          },
        ],
      },
    });
  });
});
