/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { nanoid } from "../utils";
import { WorkflowAbort, WorkflowAuthError } from "../error";
import type { RouteFunction } from "../types";
import { DisabledWorkflowContext } from "./authorization";

describe("disabled workflow context", () => {
  const token = nanoid();
  const qstashClient = new Client({
    baseUrl: MOCK_QSTASH_SERVER_URL,
    token,
    enableTelemetry: false,
  });
  const disabledContext = new DisabledWorkflowContext({
    qstashClient,
    workflowRunId: "wfr-foo",
    headers: new Headers() as Headers,
    steps: [],
    url: WORKFLOW_ENDPOINT,
    initialPayload: "my-payload",
  });
  describe("should throw abort for each step kind", () => {
    test("run", async () => {
      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = disabledContext.run("run-step", () => {
            return 1;
          });
          expect(throws).rejects.toThrow(WorkflowAuthError);
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
    test("sleep", async () => {
      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = disabledContext.sleep("sleep-step", 1);
          expect(throws).rejects.toThrow(WorkflowAuthError);
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
    test("run", async () => {
      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = disabledContext.sleepUntil("sleepUntil-step", 1);
          expect(throws).rejects.toThrow(WorkflowAuthError);
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
    test("run", async () => {
      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = disabledContext.call("call-step", { url: "some-url" });
          expect(throws).rejects.toThrow(WorkflowAuthError);
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
    test("cancel", async () => {
      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = disabledContext.cancel();
          expect(throws).rejects.toThrow(WorkflowAuthError);
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
  });

  describe("tryAuthentication", () => {
    const disabledContext = new DisabledWorkflowContext({
      qstashClient,
      workflowRunId: "wfr-foo",
      headers: new Headers() as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
      initialPayload: "my-payload",
    });

    test("should return step-found on step", async () => {
      const endpoint: RouteFunction<string, unknown> = async (context) => {
        await context.sleep("sleep-step", 1);
      };

      let called = false;
      await mockQStashServer({
        execute: async () => {
          const result = await DisabledWorkflowContext.tryAuthentication(endpoint, disabledContext);
          expect(result.isOk()).toBeTrue();
          expect(result.isOk() && result.value).toBe("step-found");
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });

    test("should return run-ended on return", async () => {
      const endpoint: RouteFunction<string, unknown> = async (_context) => {
        return;
      };

      let called = false;
      await mockQStashServer({
        execute: async () => {
          const result = await DisabledWorkflowContext.tryAuthentication(endpoint, disabledContext);
          expect(result.isOk()).toBeTrue();
          expect(result.isOk() && result.value).toBe("run-ended");
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });

    test("should get error on error", async () => {
      const endpoint: RouteFunction<string, unknown> = async (_context) => {
        throw new Error("my-error");
      };

      let called = false;
      await mockQStashServer({
        execute: async () => {
          const result = await DisabledWorkflowContext.tryAuthentication(endpoint, disabledContext);
          expect(result.isErr()).toBeTrue();
          called = true;
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });
  });

  describe("async/sync run method handling", () => {
    test("should await Promise in async method", async () => {
      const context = new WorkflowContext({
        qstashClient,
        workflowRunId: "wfr-bar",
        headers: new Headers() as Headers,
        steps: [],
        url: WORKFLOW_ENDPOINT,
        initialPayload: "my-payload",
      });

      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = context.run("step", async () => {
            return await Promise.resolve("result");
          });
          expect(throws).rejects.toThrowError(WorkflowAbort);
          called = true;
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
              body: JSON.stringify({
                stepId: 1,
                stepName: "step",
                stepType: "Run",
                out: '"result"',
                concurrent: 1,
              }),
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });

    test("should await Promise in sync method", async () => {
      const context = new WorkflowContext({
        qstashClient,
        workflowRunId: "wfr-bar",
        headers: new Headers() as Headers,
        steps: [],
        url: WORKFLOW_ENDPOINT,
        initialPayload: "my-payload",
      });

      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = context.run("step", () => {
            return Promise.resolve("result");
          });
          expect(throws).rejects.toThrowError(WorkflowAbort);
          called = true;
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
              body: JSON.stringify({
                stepId: 1,
                stepName: "step",
                stepType: "Run",
                out: '"result"',
                concurrent: 1,
              }),
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });

    test("should return non-Promise in sync method as it is", async () => {
      const context = new WorkflowContext({
        qstashClient,
        workflowRunId: "wfr-bar",
        headers: new Headers() as Headers,
        steps: [],
        url: WORKFLOW_ENDPOINT,
        initialPayload: "my-payload",
        invokeCount: 4,
      });

      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = context.run("step", () => {
            return "result";
          });
          expect(throws).rejects.toThrowError(WorkflowAbort);
          called = true;
          called = true;
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
              body: JSON.stringify({
                stepId: 1,
                stepName: "step",
                stepType: "Run",
                out: '"result"',
                concurrent: 1,
              }),
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-forward-upstash-workflow-invoke-count": "4",
                "upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });
  });
});
