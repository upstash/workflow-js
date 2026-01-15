/**
 * Integration tests for multi-region support in workflow SDK.
 * These tests modify process.env and test the full flow from environment variables
 * through to actual workflow execution with multi-region support.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@upstash/qstash";
import { serve } from "./index";
import {
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
  getRequest,
} from "../test-utils";
import { WorkflowContext } from "../context";
import { WORKFLOW_INIT_HEADER } from "../constants";

// Store original environment to restore after each test
let originalEnvironment: Record<string, string | undefined> = {};

/**
 * Helper to set up environment variables for a test
 */
function setupEnvironment(environmentVariables: Record<string, string>) {
  // Clear relevant env vars
  const keysToManage = [
    "QSTASH_TOKEN",
    "QSTASH_URL",
    "QSTASH_CURRENT_SIGNING_KEY",
    "QSTASH_NEXT_SIGNING_KEY",
    "QSTASH_REGION",
    "US_EAST_1_QSTASH_TOKEN",
    "US_EAST_1_QSTASH_URL",
    "US_EAST_1_QSTASH_CURRENT_SIGNING_KEY",
    "US_EAST_1_QSTASH_NEXT_SIGNING_KEY",
    "EU_CENTRAL_1_QSTASH_TOKEN",
    "EU_CENTRAL_1_QSTASH_URL",
    "EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY",
    "EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY",
  ];

  for (const key of keysToManage) {
    if (key in environmentVariables) {
      process.env[key] = environmentVariables[key];
    } else {
      delete process.env[key];
    }
  }
}

/**
 * Helper to restore environment variables after a test
 */
function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("Multi-Region Integration Tests", () => {
  beforeEach(() => {
    // Save current environment
    originalEnvironment = {
      QSTASH_TOKEN: process.env.QSTASH_TOKEN,
      QSTASH_URL: process.env.QSTASH_URL,
      QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
      QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY,
      QSTASH_REGION: process.env.QSTASH_REGION,
      US_EAST_1_QSTASH_TOKEN: process.env.US_EAST_1_QSTASH_TOKEN,
      US_EAST_1_QSTASH_URL: process.env.US_EAST_1_QSTASH_URL,
      US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: process.env.US_EAST_1_QSTASH_CURRENT_SIGNING_KEY,
      US_EAST_1_QSTASH_NEXT_SIGNING_KEY: process.env.US_EAST_1_QSTASH_NEXT_SIGNING_KEY,
      EU_CENTRAL_1_QSTASH_TOKEN: process.env.EU_CENTRAL_1_QSTASH_TOKEN,
      EU_CENTRAL_1_QSTASH_URL: process.env.EU_CENTRAL_1_QSTASH_URL,
      EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: process.env.EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY,
      EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: process.env.EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY,
    };
  });

  afterEach(() => {
    restoreEnvironment();
  });

  describe("Single-Region Mode (Default)", () => {
    test("should handle workflow request in single-region mode", async () => {
      setupEnvironment({
        QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        QSTASH_TOKEN: "default-token",
        QSTASH_CURRENT_SIGNING_KEY: "default-current-key",
        QSTASH_NEXT_SIGNING_KEY: "default-next-key",
      });

      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        const result = await context.run("step1", () => {
          return "workflow result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined, // Disable signature verification for this test
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(WORKFLOW_ENDPOINT, "wfr_123", { message: "test" }, [], {
            [WORKFLOW_INIT_HEADER]: "true",
          });

          const response = await handler(request);
          expect(response.status).toBe(200);

          const body = (await response.json()) as { workflowRunId?: string };
          expect(body.workflowRunId).toBeDefined();
        },
        responseFields: {
          body: { messageId: "msg_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "default-token",
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":1,"stepName":"step1","stepType":"Run","out":"\\"workflow result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });
  });

  describe("Multi-Region Mode - US East 1", () => {
    test("should handle first invocation with US region as default", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        const result = await context.run("step1", () => {
          return "us workflow result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined, // Disable signature verification
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            "wfr_us_123",
            { message: "test from US" },
            [],
            {
              [WORKFLOW_INIT_HEADER]: "true",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);

          const body = (await response.json()) as { workflowRunId?: string };
          expect(body.workflowRunId).toBeDefined();
        },
        responseFields: {
          body: { messageId: "msg_us_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "us-token", // Should use US token
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_us_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":1,"stepName":"step1","stepType":"Run","out":"\\"us workflow result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });

    test("should handle subsequent invocation with US region header", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const workflowRunId = "wfr_us_123";
      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        await context.run("step1", () => {
          return "step 1 result";
        });
        const result = await context.run("step2", () => {
          return "step 2 result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      // Mock the second invocation (after step1)
      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            workflowRunId,
            { message: "test from US" },
            [
              {
                stepId: 1,
                stepName: "step1",
                stepType: "Run",
                out: "step 1 result",
                concurrent: 1,
              },
            ],
            {
              "upstash-region": "US-EAST-1",
              "upstash-message-id": "msg_123",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: { messageId: "msg_us_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "us-token", // Should use US token based on region header
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-message-id": "msg_123",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_us_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":2,"stepName":"step2","stepType":"Run","out":"\\"step 2 result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });
  });

  describe("Multi-Region Mode - EU Central 1", () => {
    test("should handle first invocation with EU region as default", async () => {
      setupEnvironment({
        QSTASH_REGION: "EU_CENTRAL_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        const result = await context.run("step1", () => {
          return "eu workflow result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            "wfr_eu_123",
            { message: "test from EU" },
            [],
            {
              [WORKFLOW_INIT_HEADER]: "true",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);

          const body = (await response.json()) as { workflowRunId?: string };
          expect(body.workflowRunId).toBeDefined();
        },
        responseFields: {
          body: { messageId: "msg_eu_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "eu-token", // Should use EU token
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_eu_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":1,"stepName":"step1","stepType":"Run","out":"\\"eu workflow result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });

    test("should handle subsequent invocation with EU region header", async () => {
      setupEnvironment({
        QSTASH_REGION: "EU_CENTRAL_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const workflowRunId = "wfr_eu_123";
      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        await context.run("step1", () => {
          return "step 1 result";
        });
        const result = await context.run("step2", () => {
          return "step 2 result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            workflowRunId,
            { message: "test from EU" },
            [
              {
                stepId: 1,
                stepName: "step1",
                stepType: "Run",
                out: "step 1 result",
                concurrent: 1,
              },
            ],
            {
              "upstash-region": "EU-CENTRAL-1",
              "upstash-message-id": "msg_123",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: { messageId: "msg_eu_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "eu-token", // Should use EU token based on region header
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-message-id": "msg_123",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_eu_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":2,"stepName":"step2","stepType":"Run","out":"\\"step 2 result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });
  });

  describe("Region Switching", () => {
    test("should use correct region based on header in subsequent invocations", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const workflowRunId = "wfr_multi_123";
      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        await context.run("step1", () => {
          return "step 1 result";
        });
        return "done";
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      // Simulate request coming from EU region (even though default is US)
      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            workflowRunId,
            { message: "test" },
            [
              {
                stepId: 1,
                stepName: "step1",
                stepType: "Run",
                out: "step 1 result",
                concurrent: 1,
              },
            ],
            {
              "upstash-region": "EU-CENTRAL-1",
              "upstash-message-id": "msg_123",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: {},
          status: 200,
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=false`,
          token: "eu-token", // Should use EU token because of region header
          body: "done",
        },
      });
    });
  });

  describe("Client Configuration Options", () => {
    test("should pass client config options to all regions in multi-region mode", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        const result = await context.run("step1", () => {
          return "result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        qstashClient: {
          retry: {
            retries: 3,
          },
        },
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(WORKFLOW_ENDPOINT, "wfr_config_123", { message: "test" }, [], {
            [WORKFLOW_INIT_HEADER]: "true",
          });

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: { messageId: "msg_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "us-token",
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_config_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":1,"stepName":"step1","stepType":"Run","out":"\\"result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });
  });

  describe("Fallback Behavior", () => {
    test("should fallback to default region when region header is invalid", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const workflowRunId = "wfr_fallback_123";
      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        await context.run("step1", () => {
          return "step 1 result";
        });
        return "done";
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            workflowRunId,
            { message: "test" },
            [
              {
                stepId: 1,
                stepName: "step1",
                stepType: "Run",
                out: "step 1 result",
                concurrent: 1,
              },
            ],
            {
              "upstash-region": "INVALID-REGION",
              "upstash-message-id": "msg_123",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: {},
          status: 200,
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=false`,
          token: "us-token", // Should fallback to default region (US)
          body: "done",
        },
      });
    });

    test("should use default region when region header is missing", async () => {
      setupEnvironment({
        QSTASH_REGION: "EU_CENTRAL_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const workflowRunId = "wfr_missing_header_123";
      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        await context.run("step1", () => {
          return "step 1 result";
        });
        return "done";
      };

      const { handler } = serve(routeFunction, {
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(
            WORKFLOW_ENDPOINT,
            workflowRunId,
            { message: "test" },
            [
              {
                stepId: 1,
                stepName: "step1",
                stepType: "Run",
                out: "step 1 result",
                concurrent: 1,
              },
            ],
            {
              "upstash-message-id": "msg_123",
            }
          );

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: {},
          status: 200,
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=false`,
          token: "eu-token", // Should use default region (EU)
          body: "done",
        },
      });
    });
  });

  describe("Force Single-Region Mode", () => {
    test("should use single-region mode when client instance is provided", async () => {
      setupEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
      });

      const customClient = new Client({
        baseUrl: MOCK_QSTASH_SERVER_URL,
        token: "custom-token",
      });

      const routeFunction = async (context: WorkflowContext<{ message: string }>) => {
        const result = await context.run("step1", () => {
          return "result";
        });
        return result;
      };

      const { handler } = serve(routeFunction, {
        qstashClient: customClient, // Forces single-region mode
        receiver: undefined,
      });

      await mockQStashServer({
        execute: async () => {
          const request = getRequest(WORKFLOW_ENDPOINT, "wfr_custom_123", { message: "test" }, [], {
            [WORKFLOW_INIT_HEADER]: "true",
          });

          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: {
          body: { messageId: "msg_123" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token: "custom-token", // Should use custom client token, not region tokens
          body: [
            {
              destination: "https://requestcatcher.com/api",
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown, bun@1.2.11",
                "upstash-telemetry-sdk": expect.stringMatching(/^@upstash\/workflow@v1\.0\./),
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_custom_123",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: `{"stepId":1,"stepName":"step1","stepType":"Run","out":"\\"result\\"","concurrent":1}`,
            },
          ],
        },
      });
    });
  });
});
