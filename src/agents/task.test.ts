import { describe, test, expect, beforeEach } from "bun:test";
import { getWorkflowRunId, nanoid } from "../utils";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowAgents } from ".";
import { tool } from "ai";
import { z } from "zod";
import { DisabledWorkflowContext } from "../serve/authorization";

export const getAgentsApi = ({ disabledContext }: { disabledContext: boolean }) => {
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
  const model = agentsApi.openai("gpt-3.5-turbo");

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
    const { agentsApi, agent, token, workflowRunId } = getAgentsApi({ disabledContext: false });

    const customURL = "https://api.deepseek.com/v1";
    const customApiKey = nanoid();
    const task = agentsApi.task({
      agents: [agent],
      model: agentsApi.openai("gpt-3.5-turbo", { baseURL: customURL, apiKey: customApiKey }),
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
            body: '{"model":"gpt-3.5-turbo","temperature":0.1,"messages":[{"role":"system","content":"You are an agent orchestrating other AI Agents.\\n\\nThese other agents have tools available to them.\\n\\nGiven a prompt, utilize these agents to address requests.\\n\\nDon\'t always call all the agents provided to you at the same time. You can call one and use it\'s response to call another.\\n\\nAvoid calling the same agent twice in one turn. Instead, prefer to call it once but provide everything\\nyou need from that agent.\\n"},{"role":"user","content":"hello world!"}],"tools":[{"type":"function","function":{"name":"my agent","description":"An AI Agent with the following background: an agentHas access to the following tools: ai sdk tool","parameters":{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
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
});
