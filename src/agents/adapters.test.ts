import { describe, test, expect } from "bun:test";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { getWorkflowRunId, nanoid } from "../utils";
import { WorkflowTool, wrapTools } from "./adapters";
import { tool } from "ai";
import { z } from "zod";
import { LangchainTool } from "./types";

describe("wrapTools", () => {
  const token = getWorkflowRunId();
  const workflowRunId = nanoid();
  const createContext = () =>
    new WorkflowContext({
      headers: new Headers({}) as Headers,
      initialPayload: "mock",
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
      steps: [],
      url: WORKFLOW_ENDPOINT,
      workflowRunId,
    });

  const aiSDKToolDescription = "ai sdk tool";
  const langChainToolDescription = "langchain sdk tool";
  const workflowToolDescription = "workflow tool";
  const parameters = z.object({ expression: z.string() });
  const execute = async ({ expression }: { expression: string }) => expression;

  const aiSDKTool = tool({
    description: aiSDKToolDescription,
    parameters,
    execute,
  });

  const langChainTool: LangchainTool = {
    description: langChainToolDescription,
    schema: parameters,
    invoke: execute,
  };

  const wrappedWorkflowTool = new WorkflowTool({
    description: workflowToolDescription,
    schema: parameters,
    invoke: execute,
    executeAsStep: true
  })

  test("should wrap AI SDK tool with execute", async () => {
    const context = createContext();
    const wrappedTools = wrapTools({ context, tools: { aiSDKTool } });

    expect(Object.entries(wrappedTools).length).toBe(1);
    const wrappedTool = wrappedTools["aiSDKTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedTool.description).toBe(aiSDKToolDescription)

    await mockQStashServer({
      execute: () => {
        const execute = wrappedTool.execute;
        if (!execute) {
          throw new Error("execute is missing.");
        } else {
          const throws = () => execute({ expression: "hello" }, { messages: [], toolCallId: "id" });
          expect(throws).toThrowError(
            `Aborting workflow after executing step 'Run tool aiSDKTool'`
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
            body: '{"stepId":1,"stepName":"Run tool aiSDKTool","stepType":"Run","out":"\\"hello\\"","concurrent":1}',
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "3",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  });

  test("should wrap LangChain tool with execute", async () => {
    const context = createContext();
    const wrappedTools = wrapTools({ context, tools: { langChainTool } });

    expect(Object.entries(wrappedTools).length).toBe(1);
    const wrappedTool = wrappedTools["langChainTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedTool.description).toBe(langChainToolDescription)

    await mockQStashServer({
      execute: () => {
        const execute = wrappedTool.execute;
        if (!execute) {
          throw new Error("execute is missing.");
        } else {
          const throws = () => execute({ expression: "hello" }, { messages: [], toolCallId: "id" });
          expect(throws).toThrowError(
            `Aborting workflow after executing step 'Run tool langChainTool'`
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
            body: '{"stepId":1,"stepName":"Run tool langChainTool","stepType":"Run","out":"\\"hello\\"","concurrent":1}',
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "3",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  });

  test("should wrap multiple tools", async () => {
    const context = createContext();
    const wrappedTools = wrapTools({ context, tools: { langChainTool, aiSDKTool } });

    expect(Object.entries(wrappedTools).length).toBe(2);
    const wrappedLangChainTool = wrappedTools["langChainTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedLangChainTool.description).toBe(langChainToolDescription)

    const wrappedAiSDKTool = wrappedTools["aiSDKTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedAiSDKTool.description).toBe(aiSDKToolDescription)
  });

  test("should skip wrapping when wrap is false", async () => {
    const context = createContext();

    const nonwrappedWorkflowTool = new WorkflowTool({
      description: workflowToolDescription,
      schema: parameters,
      invoke: async ({ expression }) => {
        await context.sleep(`step ${expression}`, 1000)
      },
      executeAsStep: false
    })

    const wrappedTools = wrapTools({ context, tools: { nonwrappedWorkflowTool } });

    expect(Object.entries(wrappedTools).length).toBe(1);
    const wrappedTool = wrappedTools["nonwrappedWorkflowTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedTool.description).toBe(workflowToolDescription);

    await mockQStashServer({
      execute: () => {
        const execute = wrappedTool.execute;
        if (!execute) {
          throw new Error("execute is missing.");
        } else {
          const expression = "hello";
          const throws = () => execute({ expression }, { messages: [], toolCallId: "id" });
          expect(throws).toThrow("Aborting workflow after executing step 'step hello'.");
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
            body: "{\"stepId\":1,\"stepName\":\"step hello\",\"stepType\":\"SleepFor\",\"sleepFor\":1000,\"concurrent\":1}",
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "content-type": "application/json",
              "upstash-delay": "1000s",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "3",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-sdk-version": "1",
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  })

  test("should wrap when wrap is true", async () => {
    const context = createContext();
    const wrappedTools = wrapTools({ context, tools: { wrappedWorkflowTool } });

    expect(Object.entries(wrappedTools).length).toBe(1);
    const wrappedTool = wrappedTools["wrappedWorkflowTool"];
    // @ts-expect-error description exists but can't resolve the type
    expect(wrappedTool.description).toBe(workflowToolDescription)

    await mockQStashServer({
      execute: () => {
        const execute = wrappedTool.execute;
        if (!execute) {
          throw new Error("execute is missing.");
        } else {
          const throws = () => execute({ expression: "hello" }, { messages: [], toolCallId: "id" });
          expect(throws).toThrowError(
            `Aborting workflow after executing step 'Run tool wrappedWorkflowTool'`
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
            body: '{"stepId":1,"stepName":"Run tool wrappedWorkflowTool","stepType":"Run","out":"\\"hello\\"","concurrent":1}',
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "content-type": "application/json",
              "upstash-failure-callback-retries": "3",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "3",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-sdk-version": "1",
              "upstash-workflow-url": "https://requestcatcher.com/api",
            },
          },
        ],
      },
    });
  });
});
