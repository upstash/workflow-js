/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowContext } from "./context";
import { Client } from "@upstash/qstash";
import { nanoid } from "../utils";
import { WorkflowCancelAbort, WorkflowError } from "../error";
import {
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "../constants";
import { upstash } from "@upstash/qstash";

describe("context tests", () => {
  test("should set label in context and headers", () => {
    const label = "my-label";
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers({ "upstash-label": label }) as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
      label,
    });
    expect(context.label).toBe(label);
    expect(context.headers.get("upstash-label")).toBe(label);
  });
  const token = btoa(JSON.stringify({ UserID: nanoid() }));
  const qstashClient = new Client({
    baseUrl: MOCK_QSTASH_SERVER_URL,
    token,
    enableTelemetry: false,
  });
  test("should raise when there are nested steps (with run)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.run("inner step", () => {
          return "result";
        });
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner step' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with sleep)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.sleep("inner sleep", 2);
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner sleep' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with sleepUntil)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.sleepUntil("inner sleepUntil", 2);
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner sleepUntil' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with call)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.call("inner call", { url: "https://some-url.com" });
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner call' inside 'outer step'"
      )
    );
  });

  test("should not raise when there are no nested steps", async () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      invokeCount: 5,
      workflowRunCreatedAt: 0,
    });

    await mockQStashServer({
      execute: () => {
        const throws = () =>
          context.run("my-step", () => {
            return "my-result";
          });
        expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
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
            body: '{"stepId":1,"stepName":"my-step","stepType":"Run","out":"\\"my-result\\"","concurrent":1}',
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-upstash-workflow-invoke-count": "5",
              "upstash-method": "POST",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": "wfr-id",
              "upstash-workflow-url": WORKFLOW_ENDPOINT,
            },
          },
        ],
      },
    });
  });

  describe("wait for event step", () => {
    test("should send request to wait endpoint if there is a wait for event step", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        invokeCount: 5,
        workflowRunCreatedAt: 0,
      });

      const eventId = "my-event-id";
      await mockQStashServer({
        execute: () => {
          const throws = () => context.waitForEvent("my-step", eventId);
          expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/wait/${eventId}`,
          token,
          body: {
            step: {
              concurrent: 1,
              stepId: 1,
              stepName: "my-step",
              stepType: "Wait",
            },
            timeout: "7d", // default timeout
            timeoutHeaders: {
              "content-type": ["application/json"],
              "Upstash-Feature-Set": ["LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig"],
              [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: ["1"],
              [WORKFLOW_PROTOCOL_VERSION_HEADER]: [WORKFLOW_PROTOCOL_VERSION],
              "Upstash-Workflow-CallType": ["step"],
              [WORKFLOW_INIT_HEADER]: ["false"],
              [WORKFLOW_ID_HEADER]: ["wfr-id"],
              "Upstash-Workflow-Runid": ["wfr-id"],
              [WORKFLOW_URL_HEADER]: [WORKFLOW_ENDPOINT],
              "Upstash-Forward-Upstash-Workflow-Invoke-Count": ["5"],
            },
            timeoutUrl: WORKFLOW_ENDPOINT,
            url: WORKFLOW_ENDPOINT,
          },
        },
      });
    });

    test("should send request to batch endpoint if there is a parallel wait for event step", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        invokeCount: 1,
        workflowRunCreatedAt: 0,
      });

      const eventId = "my-event-id";
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            Promise.all([
              context.waitForEvent("my-wait-step", eventId, { timeout: 20 }),
              context.run("my-run-step", () => "foo"),
            ]);
          expect(throws).toThrowError("Aborting workflow after executing step 'my-wait-step'.");
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
              body: '{"stepId":0,"stepName":"my-wait-step","stepType":"Wait","waitEventId":"my-event-id","timeout":"20s","concurrent":2,"targetStep":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-forward-upstash-workflow-invoke-count": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
            {
              body: '{"stepId":0,"stepName":"my-run-step","stepType":"Run","concurrent":2,"targetStep":2}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-forward-upstash-workflow-invoke-count": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
  });

  describe("steps", () => {
    const url = "https://some-website.com";
    const body = "request-body";
    test("should send correct headers for context.call", async () => {
      const retries = 10;
      const retryDelay = "1000";
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        invokeCount: 7,
        workflowRunCreatedAt: 0,
      });
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.call("my-step", {
              url,
              body,
              headers: {
                "my-header": "my-value",
                "content-type": "application/x-www-form-urlencoded",
              },
              method: "PATCH",
              retries: retries,
              retryDelay: retryDelay,
              timeout: 30,
            });
          expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          headers: {
            "content-type": "application/json",
          },
          body: [
            {
              body: "request-body",
              destination: url,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/x-www-form-urlencoded",
                "upstash-forward-content-type": "application/x-www-form-urlencoded",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype":
                  "application/x-www-form-urlencoded",
                "upstash-callback-forward-upstash-workflow-invoke-count": "7",
                "upstash-forward-upstash-workflow-invoke-count": "7",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": "my-step",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-my-header": "my-value",
                "upstash-method": "PATCH",
                "upstash-retries": retries.toString(),
                "upstash-retry-delay": retryDelay,
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-timeout": "30",
              },
            },
          ],
        },
      });
    });

    test("should send correct headers for context.call with default retry", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.call("my-step", {
              url,
              body,
              headers: { "my-header": "my-value" },
            });
          expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
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
              body: "request-body",
              destination: url,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": "my-step",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-my-header": "my-value",
                "upstash-method": "GET",
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
    test("should send context.call without parsing body", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.call("my-step", {
              url,
              body,
              headers: { "my-header": "my-value" },
              method: "PATCH",
            });
          expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
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
              body: "request-body",
              destination: url,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": "my-step",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-my-header": "my-value",
                "upstash-method": "PATCH",
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
  });

  test("cancel should throw abort with cleanup: true", async () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      workflowRunCreatedAt: 0,
    });
    try {
      await context.cancel();
    } catch (error) {
      expect(error instanceof WorkflowCancelAbort).toBeTrue();
      const _error = error as WorkflowCancelAbort;
      expect(_error.name).toBe("WorkflowCancelAbort");
      return;
    }
    throw new Error("Test error: context.cancel should have thrown abort error.");
  });

  describe("context.api steps", () => {
    test("should throw if provider isn't provdided", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      await mockQStashServer({
        execute: () => {
          const throws = () =>
            // @ts-expect-error checking private method
            context.api.callApi("call step", {
              api: {
                name: "llm",
              },
            });
          expect(throws).toThrowError("A Provider must be provided.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
    });

    test("should throw if provider is upstash", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      await mockQStashServer({
        execute: () => {
          const throws = () =>
            // @ts-expect-error checking private method
            context.api.callApi("call step", {
              api: {
                name: "llm",
                provider: upstash(),
              },
            });
          expect(throws).toThrowError("Upstash provider isn't supported.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: false,
      });
    });

    test("should work with openai provider", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      const openAIToken = `hello-there`;
      const stepName = "call step";
      const timeout = "10s";
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.api.openai.call(stepName, {
              token: openAIToken,
              operation: "chat.completions.create",
              timeout,
              body: {
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: "Assistant says hello!",
                  },
                  { role: "user", content: "User shouts there!" },
                ],
              },
            });
          expect(throws).toThrowError(
            "This is an Upstash Workflow error thrown after a step executes"
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
              body: '{"model":"gpt-4o","messages":[{"role":"system","content":"Assistant says hello!"},{"role":"user","content":"User shouts there!"}]}',
              destination: "https://api.openai.com/v1/chat/completions",
              headers: {
                "upstash-workflow-sdk-version": "1",
                "upstash-timeout": timeout,
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": stepName,
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-authorization": `Bearer ${openAIToken}`,
                "upstash-forward-content-type": "application/json",
                "upstash-method": "POST",
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });

    test("should work with custom openai compatible provider", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        invokeCount: 5,
        workflowRunCreatedAt: 0,
      });

      const openAIToken = `hello-there`;
      const stepName = "call step";
      const timeout = "10s";
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.api.openai.call(stepName, {
              token: openAIToken,
              operation: "chat.completions.create",
              baseURL: "https://api.deepseek.com",
              timeout,
              body: {
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: "Assistant says hello!",
                  },
                  { role: "user", content: "User shouts there!" },
                ],
              },
            });
          expect(throws).toThrowError(
            "This is an Upstash Workflow error thrown after a step executes"
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
              body: '{"model":"gpt-4o","messages":[{"role":"system","content":"Assistant says hello!"},{"role":"user","content":"User shouts there!"}]}',
              destination: "https://api.deepseek.com/v1/chat/completions",
              headers: {
                "upstash-workflow-sdk-version": "1",
                "upstash-timeout": timeout,
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-invoke-count": "5",
                "upstash-forward-upstash-workflow-invoke-count": "5",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": stepName,
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-authorization": `Bearer ${openAIToken}`,
                "upstash-forward-content-type": "application/json",
                "upstash-method": "POST",
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });

    test("should work with resend provider", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      const resendToken = `hello-there`;
      const stepName = "call step";
      const timeout = "10s";
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.api.resend.call(stepName, {
              timeout,
              token: resendToken,
              body: {
                from: "Acme <onboarding@resend.dev>",
                to: ["delivered@resend.dev"],
                subject: "Hello World",
                html: "<p>It works!</p>",
              },
              headers: {
                "content-type": "application/json",
              },
            });
          expect(throws).toThrowError(
            "This is an Upstash Workflow error thrown after a step executes"
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
              body: '{"from":"Acme <onboarding@resend.dev>","to":["delivered@resend.dev"],"subject":"Hello World","html":"<p>It works!</p>"}',
              destination: "https://api.resend.com/emails",
              headers: {
                "upstash-workflow-sdk-version": "1",
                "upstash-timeout": timeout,
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": stepName,
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-authorization": `Bearer ${resendToken}`,
                "upstash-forward-content-type": "application/json",
                "upstash-method": "POST",
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });

    test("should override method and add headers if passed", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        invokeCount: 3,
        workflowRunCreatedAt: 0,
      });

      const anthropicToken = `hello-there`;
      const stepName = "call step";

      const header = "header-foo";
      const headerValue = "header-value-bar";

      const method = "GET";

      await mockQStashServer({
        execute: () => {
          const throws = () =>
            context.api.anthropic.call(stepName, {
              token: anthropicToken,
              operation: "messages.create",
              method,
              headers: {
                [header]: headerValue,
              },
              body: {
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: "Assistant says hello!",
                  },
                  { role: "user", content: "User shouts there!" },
                ],
              },
            });
          expect(throws).toThrowError(
            "This is an Upstash Workflow error thrown after a step executes"
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
              body: '{"model":"gpt-4o","messages":[{"role":"system","content":"Assistant says hello!"},{"role":"user","content":"User shouts there!"}]}',
              destination: "https://api.anthropic.com/v1/messages",
              headers: {
                "upstash-workflow-sdk-version": "1",
                [`upstash-forward-${header}`]: headerValue,
                "content-type": "application/json",
                "upstash-callback": WORKFLOW_ENDPOINT,
                "upstash-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-invoke-count": "3",
                "upstash-forward-upstash-workflow-invoke-count": "3",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": stepName,
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-id",
                "upstash-callback-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-x-api-key": anthropicToken,
                "upstash-forward-anthropic-version": "2023-06-01",
                "upstash-forward-content-type": "application/json",
                "upstash-method": method,
                "upstash-retries": "0",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
  });

  describe("webhook steps", () => {
    test("should create webhook and return webhookUrl and eventId", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      await mockQStashServer({
        execute: () => {
          const throws = () => context.createWebhook("create-webhook-step");
          expect(throws).toThrowError(
            "Aborting workflow after executing step 'create-webhook-step'."
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
              body: expect.stringMatching(
                /"stepId":1,"stepName":"create-webhook-step","stepType":"CreateWebhook"/
              ),
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });

    test("should wait for webhook with timeout", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      const webhook = {
        webhookUrl: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/hooks/user/wfr-id/evt-123`,
        eventId: "evt-123",
      };

      await mockQStashServer({
        execute: () => {
          const throws = () => context.waitForWebhook("wait-webhook-step", webhook, "30s");
          expect(throws).toThrowError(
            "Aborting workflow after executing step 'wait-webhook-step'."
          );
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/wait/evt-123`,
          token,
          body: {
            step: {
              concurrent: 1,
              stepId: 1,
              stepName: "wait-webhook-step",
              stepType: "WaitForWebhook",
            },
            timeout: "30s",
            timeoutHeaders: {
              "content-type": ["application/json"],
              "Upstash-Feature-Set": ["LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig"],
              [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: ["1"],
              [WORKFLOW_PROTOCOL_VERSION_HEADER]: [WORKFLOW_PROTOCOL_VERSION],
              "Upstash-Workflow-CallType": ["step"],
              [WORKFLOW_INIT_HEADER]: ["false"],
              [WORKFLOW_ID_HEADER]: ["wfr-id"],
              "Upstash-Workflow-Runid": ["wfr-id"],
              [WORKFLOW_URL_HEADER]: [WORKFLOW_ENDPOINT],
            },
            timeoutUrl: WORKFLOW_ENDPOINT,
            url: WORKFLOW_ENDPOINT,
          },
        },
      });
    });

    test("should create and wait for webhook in sequence", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
        workflowRunCreatedAt: 0,
      });

      // First create webhook
      await mockQStashServer({
        execute: () => {
          const throws = () => context.createWebhook("create-webhook");
          expect(throws).toThrowError("Aborting workflow after executing step 'create-webhook'.");
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
              body: expect.stringMatching(
                /"stepId":1,"stepName":"create-webhook","stepType":"CreateWebhook"/
              ),
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
  });
});
