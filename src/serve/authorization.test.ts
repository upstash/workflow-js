/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { nanoid } from "../utils";
import { QStashWorkflowAbort } from "../error";
import type { RouteFunction } from "../types";
import { DisabledWorkflowContext } from "./authorization";

describe("disabled workflow context", () => {
  const token = nanoid();
  const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });
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
          expect(throws).rejects.toThrow(QStashWorkflowAbort);
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
          expect(throws).rejects.toThrow(QStashWorkflowAbort);
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
          expect(throws).rejects.toThrow(QStashWorkflowAbort);
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
          const throws = disabledContext.call("call-step", { url: "some-url"});
          expect(throws).rejects.toThrow(QStashWorkflowAbort);
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
      const endpoint: RouteFunction<string> = async (context) => {
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
      // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
      const endpoint: RouteFunction<string> = async (_context) => {
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
      // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
      const endpoint: RouteFunction<string> = async (_context) => {
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
        retries: 0,
      });

      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = context.run("step", async () => {
            return await Promise.resolve("result");
          });
          expect(throws).rejects.toThrowError(QStashWorkflowAbort);
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
              body: '{"stepId":1,"stepName":"step","stepType":"Run","out":"result","concurrent":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-retries": "0",
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
          expect(throws).rejects.toThrowError(QStashWorkflowAbort);
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
              body: '{"stepId":1,"stepName":"step","stepType":"Run","out":"result","concurrent":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-retries": "3",
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
      });

      let called = false;
      await mockQStashServer({
        execute: () => {
          const throws = context.run("step", () => {
            return "result";
          });
          expect(throws).rejects.toThrowError(QStashWorkflowAbort);
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
              body: '{"stepId":1,"stepName":"step","stepType":"Run","out":"result","concurrent":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-retries": "3",
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
