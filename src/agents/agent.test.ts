import { describe, test, expect, beforeEach } from "bun:test";
import { Agent, ManagerAgent } from "./agent";
import { WorkflowContext } from "../context";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { Client } from "@upstash/qstash";
import { getWorkflowRunId, nanoid } from "../utils";
import { WorkflowAgents } from ".";
import { tool } from "ai";
import { z } from "zod";
import { getAgentsApi } from "./task.test";

describe("agents", () => {
  const openaiToken = nanoid();
  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = openaiToken;
  });

  const token = getWorkflowRunId();
  const workflowRunId = nanoid();
  const context = new WorkflowContext({
    headers: new Headers({}) as Headers,
    initialPayload: "mock",
    qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token, enableTelemetry: false }),
    steps: [],
    url: WORKFLOW_ENDPOINT,
    workflowRunId,
    retries: 5,
    retryDelay: "1000",
  });

  const agentsApi = new WorkflowAgents({ context });

  const background = "an agent";
  const maxSteps = 2;
  const name = "my agent";
  const temparature = 0.4;

  const flowControlKey = "flowControlKey";
  const model = agentsApi.openai("gpt-3.5-turbo", {
    callSettings: {
      flowControl: {
        key: flowControlKey,
        parallelism: 2,
      },
      retries: 5,
      timeout: 10,
      retryDelay: "1000",
    },
  });

  const agent = new Agent(
    {
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
    },
    context
  );

  describe("single agent", () => {
    test("should initialize and call agent", async () => {
      expect(agent.background).toBe(background);
      expect(agent.maxSteps).toBe(maxSteps);
      expect(agent.model.modelId).toBe(model.modelId);
      expect(agent.model.provider).toBe(model.provider);
      expect(agent.name).toBe(name);
      expect(agent.temparature).toBe(temparature);
      expect(Object.entries(agent.tools).length).toBe(1);
      expect(agent.tools["tool"]).toBeDefined();

      await mockQStashServer({
        execute: () => {
          const throws = async () => agent.call({ prompt: "my prompt" });
          expect(throws).toThrowError(
            `Aborting workflow after executing step 'Call Agent my agent'`
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
              body: '{"model":"gpt-3.5-turbo","temperature":0.4,"messages":[{"role":"system","content":"an agent"},{"role":"user","content":"my prompt"}],"tools":[{"type":"function","function":{"name":"tool","description":"ai sdk tool","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
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
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": workflowRunId,
                "upstash-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-authorization": `Bearer ${openaiToken}`,
                "upstash-forward-content-type": "application/json",
                "upstash-forward-upstash-agent-name": "my agent",
                "upstash-method": "POST",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-url": "https://requestcatcher.com/api",
                "upstash-callback-retries": "5",
                "upstash-callback-retry-delay": "1000",
                "upstash-flow-control-key": "flowControlKey",
                "upstash-flow-control-value": "parallelism=2",
                "upstash-retries": "5",
                "upstash-retry-delay": "1000",
                "upstash-timeout": "10",
              },
            },
          ],
        },
      });
    });

    test("should convert agent to tool", async () => {
      const agentTool = agent.asTool();

      expect(agentTool.description).toBe(
        "An AI Agent with the following background: an agentHas access to the following tools: ai sdk tool"
      );

      await mockQStashServer({
        execute: () => {
          const execute = agentTool.execute;
          if (!execute) {
            throw new Error("execute is missing.");
          } else {
            const throws = () => execute({ prompt: "hello" }, { messages: [], toolCallId: "id" });
            expect(throws).toThrowError(
              `Aborting workflow after executing step 'Call Agent my agent'`
            );
          }
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
              body: '{"model":"gpt-3.5-turbo","temperature":0.4,"messages":[{"role":"system","content":"an agent"},{"role":"user","content":"hello"}],"tools":[{"type":"function","function":{"name":"tool","description":"ai sdk tool","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
              destination: "https://api.openai.com/v1/chat/completions",
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-callback": "https://requestcatcher.com/api",
                "upstash-callback-feature-set": "LazyFetch,InitialBody",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "2",
                "upstash-callback-forward-upstash-workflow-stepname": "Call Agent my agent",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-retries": "5",
                "upstash-callback-retry-delay": "1000",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": workflowRunId,
                "upstash-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-authorization": `Bearer ${openaiToken}`,
                "upstash-forward-content-type": "application/json",
                "upstash-forward-upstash-agent-name": "my agent",
                "upstash-method": "POST",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": workflowRunId,
                "upstash-workflow-url": "https://requestcatcher.com/api",
                "upstash-flow-control-key": "flowControlKey",
                "upstash-flow-control-value": "parallelism=2",
                "upstash-retries": "5",
                "upstash-retry-delay": "1000",
                "upstash-timeout": "10",
              },
            },
          ],
        },
      });
    });
  });

  test("multi agent", async () => {
    const managerAgent = new ManagerAgent(
      {
        agents: [agent],
        maxSteps: 2,
        model,
      },
      context
    );

    await mockQStashServer({
      execute: () => {
        const throws = async () => managerAgent.call({ prompt: "my prompt" });
        expect(throws).toThrowError(
          `Aborting workflow after executing step 'Call Agent manager llm'`
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
            body: '{"model":"gpt-3.5-turbo","temperature":0.1,"messages":[{"role":"system","content":"You are an agent orchestrating other AI Agents.\\n\\nThese other agents have tools available to them.\\n\\nGiven a prompt, utilize these agents to address requests.\\n\\nDon\'t always call all the agents provided to you at the same time. You can call one and use it\'s response to call another.\\n\\nAvoid calling the same agent twice in one turn. Instead, prefer to call it once but provide everything\\nyou need from that agent.\\n"},{"role":"user","content":"my prompt"}],"tools":[{"type":"function","function":{"name":"my agent","description":"An AI Agent with the following background: an agentHas access to the following tools: ai sdk tool","parameters":{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}}],"tool_choice":"auto"}',
            destination: "https://api.openai.com/v1/chat/completions",
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-callback": "https://requestcatcher.com/api",
              "upstash-callback-feature-set": "LazyFetch,InitialBody",
              "upstash-callback-forward-upstash-workflow-callback": "true",
              "upstash-callback-forward-upstash-workflow-concurrent": "1",
              "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
              "upstash-callback-forward-upstash-workflow-stepid": "3",
              "upstash-callback-forward-upstash-workflow-stepname": "Call Agent manager llm",
              "upstash-callback-forward-upstash-workflow-steptype": "Call",
              "upstash-callback-retries": "5",
              "upstash-callback-retry-delay": "1000",
              "upstash-callback-workflow-calltype": "fromCallback",
              "upstash-callback-workflow-init": "false",
              "upstash-callback-workflow-runid": workflowRunId,
              "upstash-callback-workflow-url": "https://requestcatcher.com/api",
              "upstash-feature-set": "WF_NoDelete,InitialBody",
              "upstash-forward-authorization": `Bearer ${openaiToken}`,
              "upstash-forward-content-type": "application/json",
              "upstash-forward-upstash-agent-name": "manager llm",
              "upstash-method": "POST",
              "upstash-workflow-calltype": "toCallback",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
              "upstash-flow-control-key": "flowControlKey",
              "upstash-flow-control-value": "parallelism=2",
              "upstash-retries": "5",
              "upstash-retry-delay": "1000",
              "upstash-timeout": "10",
            },
          },
        ],
      },
    });
  });

  describe("disabled context", () => {
    const { agent } = getAgentsApi({ disabledContext: true });
    test("should throw abort when empty prompt", async () => {
      // @ts-expect-error for testing purposes, prompt is object
      const prompt: string = { some: "object" };

      await mockQStashServer({
        execute: async () => {
          const throws = () => agent.call({ prompt });
          expect(throws).toThrow(
            "Aborting workflow after executing step 'disabled-qstash-worklfow-run'"
          );
        },
        receivesRequest: false,
        responseFields: {
          body: "",
          status: 200,
        },
      });
    });

    test("should throw abort when object prompt", async () => {
      // @ts-expect-error for testing purposes, prompt is undefiend
      const prompt: string = undefined;

      await mockQStashServer({
        execute: async () => {
          const throws = () => agent.call({ prompt });
          expect(throws).toThrow(
            "Aborting workflow after executing step 'disabled-qstash-worklfow-run'"
          );
        },
        receivesRequest: false,
        responseFields: {
          body: "",
          status: 200,
        },
      });
    });
  });
  test("disabled context with empty or object prompt should throw abort", async () => {});
});
