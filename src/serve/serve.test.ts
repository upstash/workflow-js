/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, spyOn, test } from "bun:test";
import { serve } from ".";
import {
  driveWorkflow,
  getRequest,
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
} from "../test-utils";
import { nanoid } from "../utils";
import { Client } from "@upstash/qstash";
import { Client as WorkflowClient } from "../client";
import type { FinishCondition, RouteFunction, Step, WorkflowServeOptions } from "../types";
import {
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "../constants";
import { AUTH_FAIL_MESSAGE, processOptions } from "./options";
import { WorkflowLogger } from "../logger";
import { z } from "zod";

const someWork = (input: string) => {
  return `processed '${input}'`;
};

const workflowRunId = `wfr${nanoid()}`;
const token = nanoid();

const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

describe("serve", () => {
  test("should send create workflow request in initial request", async () => {
    const { handler: endpoint } = serve(
      async (context) => {
        const _input = context.requestPayload;
        await context.sleep("sleep 1", 1);
        return 2;
      },
      {
        qstashClient,
        verbose: true,
        receiver: undefined,
        retries: 1,
        schema: z.string(),
        flowControl: {
          key: "my-key",
          parallelism: 1,
        },
      }
    );

    const initialPayload = nanoid();
    const request = new Request(WORKFLOW_ENDPOINT, {
      method: "POST",
      body: initialPayload,
    });
    await mockQStashServer({
      execute: async () => {
        const response = await endpoint(request);
        expect(response.status).toBe(200);
      },
      responseFields: { body: "msgId", status: 200 },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
        token,
        body: initialPayload,
        headers: {
          [WORKFLOW_INIT_HEADER]: "true",
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: "1",
          [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: "1",
          "upstash-retries": "1",
          "Upstash-Flow-Control-Key": "my-key",
          "Upstash-Flow-Control-Value": "parallelism=1",
        },
      },
    });
  });

  test("path endpoint", async () => {
    const flowControl = {
      key: "my-key",
      ratePerSecond: 3,
    };
    const { handler: endpoint } = serve<string>(
      async (context) => {
        expect(context.flowControl).toEqual(flowControl);
        const input = context.requestPayload;

        const result1 = await context.run("step1", async () => {
          return someWork(input);
        });

        await context.run("step2", async () => {
          const result = someWork(result1);
          return result;
        });
      },
      {
        qstashClient,
        verbose: true,
        receiver: undefined,
        disableTelemetry: true,
        flowControl,
      }
    );

    const initialPayload = "initial-payload";
    const steps: Step[] = [
      {
        stepId: 1,
        stepName: "step1",
        stepType: "Run",
        out: JSON.stringify(`processed '${initialPayload}'`),
        concurrent: 1,
      },
      {
        stepId: 2,
        stepName: "step2",
        stepType: "Run",
        out: JSON.stringify(`processed 'processed '${initialPayload}''`),
        concurrent: 1,
      },
    ];

    await driveWorkflow({
      execute: async (initialPayload, steps, first) => {
        const request = first
          ? new Request(WORKFLOW_ENDPOINT, {
            body: JSON.stringify(initialPayload),
            method: "POST",
          })
          : getRequest(WORKFLOW_ENDPOINT, workflowRunId, initialPayload, steps);

        request.headers.set(WORKFLOW_INVOKE_COUNT_HEADER, "2");

        const response = await endpoint(request);
        expect(response.status).toBe(200);
      },
      initialPayload,
      iterations: [
        {
          stepsToAdd: [],
          responseFields: {
            body: { messageId: "some-message-id" },
            status: 200,
          },
          receivesRequest: {
            method: "POST",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/https://requestcatcher.com/api`,
            token,
            body: initialPayload,
            headers: {
              "upstash-workflow-sdk-version": "1",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-upstash-workflow-invoke-count": "2",
              "upstash-method": "POST",
              "upstash-workflow-init": "true",
              "upstash-workflow-url": WORKFLOW_ENDPOINT,
              "upstash-flow-control-key": "my-key",
              "upstash-flow-control-value": "rate=3",
            },
          },
        },
        {
          stepsToAdd: [],
          responseFields: {
            body: { messageId: "some-message-id" },
            status: 200,
          },
          receivesRequest: {
            method: "POST",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
            token,
            body: [
              {
                body: JSON.stringify(steps[0]),
                destination: WORKFLOW_ENDPOINT,
                headers: {
                  "upstash-workflow-sdk-version": "1",
                  "content-type": "application/json",
                  "upstash-feature-set": "LazyFetch,InitialBody",
                  "upstash-forward-upstash-workflow-sdk-version": "1",
                  "upstash-forward-upstash-workflow-invoke-count": "2",
                  "upstash-method": "POST",
                  "upstash-workflow-runid": workflowRunId,
                  "upstash-workflow-init": "false",
                  "upstash-workflow-url": WORKFLOW_ENDPOINT,
                  "upstash-flow-control-key": "my-key",
                  "upstash-flow-control-value": "rate=3",
                },
              },
            ],
          },
        },
        {
          stepsToAdd: [steps[0]],
          responseFields: {
            body: { messageId: "some-message-id" },
            status: 200,
          },
          receivesRequest: {
            method: "POST",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
            token,
            body: [
              {
                destination: WORKFLOW_ENDPOINT,
                headers: {
                  "upstash-workflow-sdk-version": "1",
                  "content-type": "application/json",
                  "upstash-feature-set": "LazyFetch,InitialBody",
                  "upstash-forward-upstash-workflow-sdk-version": "1",
                  "upstash-forward-upstash-workflow-invoke-count": "2",
                  "upstash-method": "POST",
                  "upstash-workflow-runid": workflowRunId,
                  "upstash-workflow-init": "false",
                  "upstash-workflow-url": WORKFLOW_ENDPOINT,
                  "upstash-flow-control-key": "my-key",
                  "upstash-flow-control-value": "rate=3",
                },
                body: JSON.stringify(steps[1]),
              },
            ],
          },
        },
        {
          stepsToAdd: [steps[1]],
          responseFields: { body: "msgId", status: 200 },
          receivesRequest: {
            method: "DELETE",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=false`,
            token,
            body: undefined,
          },
        },
      ],
    });
  });

  test("should return 500 on error during step execution", async () => {
    let onErrorCalled = false;
    const { handler: endpoint } = serve(
      async (context) => {
        await context.run("wrong step", async () => {
          throw new Error("some-error");
        });
      },
      {
        qstashClient,
        receiver: undefined,
        onError(error) {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("some-error");
          onErrorCalled = true;
        },
      }
    );

    const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
    let called = false;
    await mockQStashServer({
      execute: async () => {
        const response = await endpoint(request);
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        expect(response.status).toBe(500);
        expect(response.statusText).toBe("");
        const result = await response.json();
        expect(result).toEqual({
          error: "Error",
          message: "some-error",
        });
        called = true;
      },
      responseFields: { body: { messageId: "some-message-id" }, status: 200 },
      receivesRequest: false,
    });
    expect(called).toBeTrue();
    expect(onErrorCalled).toBeTrue();
  });

  test("should call onFinish with auth-fail if authentication fails", async () => {
    const { handler: endpoint } = serve(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_context) => {
        // we call `return` when auth fails:
        return;
      },
      {
        qstashClient,
        receiver: undefined,
        onStepFinish(workflowRunId, finishCondition) {
          return new Response(JSON.stringify({ workflowRunId, finishCondition }), { status: 200 });
        },
      }
    );

    const workflowRunId = "wfr-foo";
    const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, "my-payload", []);
    let called = false;
    await mockQStashServer({
      execute: async () => {
        const response = await endpoint(request);
        const { workflowRunId, finishCondition } = (await response.json()) as {
          workflowRunId: string;
          finishCondition: FinishCondition;
        };
        expect(workflowRunId).toBe(workflowRunId);
        expect(finishCondition).toBe("auth-fail");
        called = true;
      },
      responseFields: { body: { messageId: "some-message-id" }, status: 200 },
      receivesRequest: false,
    });
    expect(called).toBeTrue();
  });

  describe("duplicate checks", () => {
    const { handler: endpoint } = serve(
      async (context) => {
        const result1 = await context.run("step 1", () => {
          return "result 1";
        });
        const result2 = await context.run("step 2", () => {
          return "result 2";
        });
        await context.run("step 3", () => {
          return `combined results: ${[result1, result2]}`;
        });
      },
      {
        qstashClient,
        receiver: undefined,
        onStepFinish(workflowRunId, finishCondition) {
          return new Response(JSON.stringify({ workflowRunId, finishCondition }), { status: 200 });
        },
      }
    );

    test("should return without doing anything when the last step is duplicate", async () => {
      // prettier-ignore
      const stepsWithDuplicate: Step[] = [
        { stepId: 1, stepName: "step 1", stepType: "Run", out: "result 1", concurrent: 1 },
        { stepId: 2, stepName: "step 2", stepType: "Run", out: "result 2", concurrent: 1 },
        { stepId: 2, stepName: "step 2", stepType: "Run", out: "result 2", concurrent: 1 }, // duplicate
      ]
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-foo", "my-payload", stepsWithDuplicate);
      let called = false;
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          const { workflowRunId, finishCondition } = (await response.json()) as {
            workflowRunId: string;
            finishCondition: FinishCondition;
          };
          expect(workflowRunId).toBe("wfr-foo");
          expect(finishCondition).toBe("duplicate-step");
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: false,
      });
      expect(called).toBeTrue();
    });

    test("should remove duplicate middle step and continue executing", async () => {
      // prettier-ignore
      const stepsWithDuplicate: Step[] = [
        { stepId: 1, stepName: "step 1", stepType: "Run", out: "result 1", concurrent: 1 },
        { stepId: 1, stepName: "step 1", stepType: "Run", out: "result 1", concurrent: 1 }, // duplicate
        { stepId: 2, stepName: "step 2", stepType: "Run", out: "result 2", concurrent: 1 },
      ]
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-foo", "my-payload", stepsWithDuplicate);
      let called = false;
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          const { workflowRunId, finishCondition } = (await response.json()) as {
            workflowRunId: string;
            finishCondition: FinishCondition;
          };
          expect(workflowRunId).toBe("wfr-foo");
          expect(finishCondition).toBe("success");
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-foo",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
              },
              body: '{"stepId":3,"stepName":"step 3","stepType":"Run","out":"\\"combined results: result 1,result 2\\"","concurrent":1}',
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });
  });

  describe("failure settings", () => {
    const routeFunction: RouteFunction<unknown> = async (context) => {
      await context.sleep("sleep-step", 1);
    };

    test("should not have failureUrl if failureUrl or failureFunction is not passed", async () => {
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
      const { handler: endpoint } = serve(routeFunction, {
        qstashClient,
        receiver: undefined,
      });
      let called = false;
      await mockQStashServer({
        execute: async () => {
          const result = await endpoint(request);
          expect(result.status).toBe(200);
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody",
                "upstash-delay": "1s",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
              },
              body: '{"stepId":1,"stepName":"sleep-step","stepType":"SleepFor","sleepFor":1,"concurrent":1}',
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });

    test("should set failureUrl if failureUrl is passed", async () => {
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
      const myFailureEndpoint = "https://www.my-failure-endpoint.com/api";
      const { handler: endpoint } = serve(routeFunction, {
        qstashClient,
        receiver: undefined,
        failureUrl: myFailureEndpoint,
      });
      let called = false;
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          expect(response.status).toBe(200);
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody",
                "upstash-delay": "1s",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-failure-callback": myFailureEndpoint,
                "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
                "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
                "upstash-failure-callback-workflow-calltype": "failureCall",
                "upstash-failure-callback-workflow-init": "false",
                "upstash-failure-callback-workflow-runid": "wfr-bar",
                "upstash-failure-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
              },
              body: '{"stepId":1,"stepName":"sleep-step","stepType":"SleepFor","sleepFor":1,"concurrent":1}',
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });

    test("should set failureUrl as context url if failureFunction is passed", async () => {
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
      let called = false;
      const myFailureFunction: WorkflowServeOptions["failureFunction"] = async () => {
        return;
      };
      const { handler: endpoint } = serve(routeFunction, {
        qstashClient,
        receiver: undefined,
        failureFunction: myFailureFunction,
      });
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          expect(response.status).toBe(200);
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-workflow-sdk-version": "1",
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody",
                "upstash-delay": "1s",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-bar",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
                "upstash-failure-callback": WORKFLOW_ENDPOINT,
                "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
                "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
                "upstash-failure-callback-workflow-calltype": "failureCall",
                "upstash-failure-callback-workflow-init": "false",
                "upstash-failure-callback-workflow-runid": "wfr-bar",
                "upstash-failure-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
              },
              body: '{"stepId":1,"stepName":"sleep-step","stepType":"SleepFor","sleepFor":1,"concurrent":1}',
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });

    test("should set failure headers in context call", async () => {
      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-foo", "my-payload", []);
      let called = false;
      const myFailureFunction: WorkflowServeOptions["failureFunction"] = async () => {
        return;
      };


      const routeFunction: RouteFunction<unknown> = async (context) => {
        await context.call("call step", {
          url: "some-url",
          retries: 4,
          timeout: 10,
          headers: {
            "test": "headers"
          },
          body: "body",
          method: "PATCH"
        });
      };

      const { handler: endpoint } = serve(routeFunction, {
        qstashClient,
        receiver: undefined,
        failureUrl: "some-failure-url",
        retries: 2
      });
      await mockQStashServer({
        execute: async () => {
          const response = await endpoint(request);
          expect(response.status).toBe(200);
          called = true;
        },
        responseFields: { body: { messageId: "some-message-id" }, status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: "some-url",
              headers: {
                "content-type": "application/json",
                "upstash-callback": "https://requestcatcher.com/api",
                "upstash-callback-failure-callback-feature-set": "LazyFetch,InitialBody",
                "upstash-callback-failure-callback": "some-failure-url",
                "upstash-callback-failure-callback-forward-upstash-workflow-failure-callback": "true",
                "upstash-callback-failure-callback-forward-upstash-workflow-is-failure": "true",
                "upstash-callback-failure-callback-retries": "2",
                "upstash-callback-failure-callback-workflow-calltype": "failureCall",
                "upstash-callback-failure-callback-workflow-init": "false",
                "upstash-callback-failure-callback-workflow-runid": "wfr-foo",
                "upstash-callback-failure-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-callback-feature-set": "LazyFetch,InitialBody",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": "call step",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-retries": "2",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr-foo",
                "upstash-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-failure-callback-feature-set": "LazyFetch,InitialBody",
                "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
                "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
                "upstash-failure-callback-retries": "2",
                "upstash-failure-callback-workflow-calltype": "failureCall",
                "upstash-failure-callback-workflow-init": "false",
                "upstash-failure-callback-workflow-runid": "wfr-foo",
                "upstash-failure-callback-workflow-url": "https://requestcatcher.com/api",
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-forward-test": "headers",
                "upstash-method": "PATCH",
                "upstash-retries": "4",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": "unknown",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
                "upstash-timeout": "10",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-foo",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api",
              },
              body: '"body"',
            },
          ],
        },
      });
      expect(called).toBeTrue();
    });
  });

  describe("should replace baseUrl correctly", () => {
    const testBaseUrl = async (
      requestUrl: string,
      baseUrl: string,
      contextUrl: string,
      url?: string
    ) => {
      const request = new Request(requestUrl, {
        headers: {
          [WORKFLOW_INIT_HEADER]: "false",
          [WORKFLOW_ID_HEADER]: "wfr-id",
        },
      });
      let called = false;
      const { handler: endpoint } = serve(
        async (context) => {
          expect(context.url).toBe(contextUrl);
          called = true;
        },
        {
          url,
          baseUrl,
          qstashClient,
          receiver: undefined,
        }
      );
      await endpoint(request);
      expect(called).toBeTrue();
    };

    test("should replace localhost correctly", async () => {
      await testBaseUrl(
        "http://localhost:3000/api/path",
        "http://www.local-tunnel.com",
        "http://www.local-tunnel.com/api/path"
      );

      await testBaseUrl(
        "https://localhost:3000/api/path",
        "http://www.local-tunnel.com",
        "http://www.local-tunnel.com/api/path"
      );

      await testBaseUrl(
        "http://localhost:8080/api/path",
        "http://www.local-tunnel.com",
        "http://www.local-tunnel.com/api/path"
      );
    });

    test("should replace other url correctly", async () => {
      await testBaseUrl(
        "http://www.my-endpoint.com.it/api/path",
        "http://www.local-tunnel.com.gov.uk",
        "http://www.local-tunnel.com.gov.uk/api/path"
      );
    });
  });

  test("should receive env passed in options", async () => {
    const request = new Request(WORKFLOW_ENDPOINT, {
      headers: {},
    });
    let called = false;
    const { handler: endpoint } = serve(
      async (context) => {
        expect(context.env["env-var-1"]).toBe("value-1");
        expect(context.env["env-var-2"]).toBe("value-2");
        called = true;
        return;
      },
      {
        qstashClient,
        receiver: undefined,
        env: {
          "env-var-1": "value-1",
          "env-var-2": "value-2",
        },
      }
    );
    const response = await endpoint(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: AUTH_FAIL_MESSAGE,
      workflowRunId: "no-workflow-id",
    });
    expect(called).toBeTrue();
  });

  test("should not initialize verifier if keys are not set", () => {
    const { receiver } = processOptions({
      env: {
        QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        QSTASH_TOKEN: "mock-token",
      },
    });
    expect(receiver).toBeUndefined();
  });

  test("should initialize verifier if keys are set", () => {
    const { receiver } = processOptions({
      env: {
        QSTASH_URL: MOCK_QSTASH_SERVER_URL,
        QSTASH_TOKEN: "mock-token",
        QSTASH_CURRENT_SIGNING_KEY: "key-1",
        QSTASH_NEXT_SIGNING_KEY: "key-2",
      },
    });
    expect(receiver).toBeDefined();
  });

  test("should call qstash to cancel workflow on context.cancel", async () => {
    const request = getRequest(WORKFLOW_ENDPOINT, "wfr-foo", "my-payload", []);
    let called = false;
    let runs = false;
    const { handler: endpoint } = serve(
      async (context) => {
        called = true;
        await context.cancel();
        await context.run("wont run", () => {
          runs = true;
        });
      },
      {
        qstashClient,
        receiver: undefined,
        verbose: true,
      }
    );

    await mockQStashServer({
      execute: async () => {
        const response = await endpoint(request);
        expect(response.status).toBe(200);
      },
      responseFields: { body: undefined, status: 200 },
      receivesRequest: {
        method: "DELETE",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/wfr-foo?cancel=true`,
        token,
      },
    });
    expect(called).toBeTrue();
    expect(runs).toBeFalse();
  });

  test("should send waitForEvent", async () => {
    const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
    const { handler: endpoint } = serve(
      async (context) => {
        await context.waitForEvent("waiting step", "wait-event-id", { timeout: "10d" });
      },
      {
        qstashClient,
        receiver: undefined,
        retries: 2,
        flowControl: {
          key: "fc-key",
          ratePerSecond: 2,
        },
      }
    );
    let called = false;
    await mockQStashServer({
      execute: async () => {
        const result = await endpoint(request);
        expect(result.status).toBe(200);
        called = true;
      },
      responseFields: { body: { messageId: "some-message-id" }, status: 200 },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/wait/wait-event-id`,
        token,
        body: {
          step: {
            concurrent: 1,
            stepId: 1,
            stepName: "waiting step",
            stepType: "Wait",
          },
          timeout: "10d",
          timeoutHeaders: {
            "Upstash-Workflow-Sdk-Version": ["1"],
            "content-type": ["application/json"],
            "Upstash-Feature-Set": ["LazyFetch,InitialBody"],
            "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
            "Upstash-Retries": ["2"],
            "Upstash-Flow-Control-Key": ["fc-key"],
            "Upstash-Flow-Control-Value": ["rate=2"],
            "Upstash-Workflow-CallType": ["step"],
            "Upstash-Workflow-Init": ["false"],
            "Upstash-Workflow-RunId": ["wfr-bar"],
            "Upstash-Workflow-Runid": ["wfr-bar"],
            "Upstash-Workflow-Url": [WORKFLOW_ENDPOINT],
            "Upstash-Telemetry-Framework": ["unknown"],
            "Upstash-Telemetry-Runtime": ["unknown"],
            "Upstash-Telemetry-Sdk": ["@upstash/workflow@v0.2.7"],
          },
          timeoutUrl: WORKFLOW_ENDPOINT,
          url: WORKFLOW_ENDPOINT,
        },
      },
    });
    expect(called).toBeTrue();
  });

  describe("finish conditions", () => {
    describe("workflow-already-ended", () => {
      test("third party return", async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const request = new Request(WORKFLOW_ENDPOINT, {
          headers: {
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            "upstash-workflow-callback": "true",
            "upstash-workflow-runid": workflowRunId,
            "upstash-message-id": "msg-id",
          },
          method: "POST",
        });

        let called = false;
        const { handler } = serve(
          async (context) => {
            await context.sleep("first step", 2);
          },
          {
            onStepFinish(finishRunId, finishCondition) {
              console.log(finishRunId, workflowRunId);

              expect(finishRunId).toBe(workflowRunId);
              expect(finishCondition).toBe("workflow-already-ended");
              called = true;
              return new Response(JSON.stringify({ finishRunId }), { status: 200 });
            },
            receiver: undefined,
            qstashClient,
          }
        );

        await mockQStashServer({
          execute: () => handler(request),
          receivesRequest: {
            url: `http://localhost:8080/v2/workflows/runs/${workflowRunId}`,
            method: "GET",
            token,
            body: "",
          },
          responseFields: {
            status: 404,
            body: "not found",
          },
        });

        expect(called).toBeTrue();
      });

      test("regular call", async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const request = new Request(WORKFLOW_ENDPOINT, {
          method: "POST",
          headers: {
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            [WORKFLOW_ID_HEADER]: workflowRunId,
            [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
          },
        });

        let called = false;
        const { handler } = serve(
          async (context) => {
            console.log(context);
          },
          {
            onStepFinish(finishRunId, finishCondition) {
              expect(finishRunId).toBe(workflowRunId);
              expect(finishCondition).toBe("workflow-already-ended");
              called = true;
              return new Response(JSON.stringify({ finishRunId }), { status: 200 });
            },
            receiver: undefined,
            qstashClient,
          }
        );

        await mockQStashServer({
          execute: () => handler(request),
          receivesRequest: {
            url: `http://localhost:8080/v2/workflows/runs/${workflowRunId}`,
            method: "GET",
            token,
            body: "",
          },
          responseFields: {
            status: 404,
            body: "not found",
          },
        });

        expect(called).toBeTrue();
      });

      test("regular call live", async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const request = new Request(WORKFLOW_ENDPOINT, {
          method: "POST",
          headers: {
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            [WORKFLOW_ID_HEADER]: workflowRunId,
            [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
          },
        });

        let called = false;
        const { handler } = serve(
          async (context) => {
            console.log(context);
          },
          {
            onStepFinish(finishRunId, finishCondition) {
              expect(finishRunId).toBe(workflowRunId);
              expect(finishCondition).toBe("workflow-already-ended");
              called = true;
              return new Response(JSON.stringify({ finishRunId }), { status: 200 });
            },
            receiver: undefined,
          }
        );

        const response = await handler(request);
        expect(response.status).toBe(200);

        expect(called).toBeTrue();
      });
    });
  });

  describe("incorrect url will throw", () => {
    const qstashClient = new Client({ token: process.env.QSTASH_TOKEN! });
    const client = new WorkflowClient({ token: process.env.QSTASH_TOKEN! });

    test("allow http://", async () => {
      const url = "http://requestcatcher.com";
      const { handler } = serve(
        async (context) => {
          await context.sleep("sleeping", 1);
        },
        {
          url,
          baseUrl: undefined,
          qstashClient,
          receiver: undefined,
        }
      );

      const response = await handler(new Request(url, { method: "POST" }));
      expect(response.status).toBe(200);
      const { workflowRunId } = (await response.json()) as { workflowRunId: string };
      expect(workflowRunId).toBeString();

      await client.cancel({ ids: workflowRunId });
    });

    test("allow https://", async () => {
      const url = "https://requestcatcher.com";
      const { handler } = serve(
        async (context) => {
          await context.sleep("sleeping", 1);
        },
        {
          url,
          baseUrl: undefined,
          qstashClient,
          receiver: undefined,
        }
      );

      const response = await handler(new Request(url, { method: "POST" }));
      expect(response.status).toBe(200);
      const { workflowRunId } = (await response.json()) as { workflowRunId: string };
      expect(workflowRunId).toBeString();

      await client.cancel({ ids: workflowRunId });
    });

    test("should not allow when not http:// or https://", async () => {
      const url = "localhost.com";
      const verbose = new WorkflowLogger({ logLevel: "INFO", logOutput: "console" });

      const logSpy = spyOn(verbose, "log");

      const { handler } = serve(
        async (context) => {
          await context.sleep("sleeping", 1);
        },
        {
          url,
          baseUrl: undefined,
          qstashClient,
          receiver: undefined,
          verbose,
        }
      );

      const response = await handler(new Request("https://requestcatcher.com", { method: "POST" }));
      expect(response.status).toBe(500);
      const content = await response.json();
      expect(content).toEqual({
        error: "WorkflowError",
        message: `Workflow URL should start with 'http://' or 'https://'. Recevied is '${url}'`,
      });

      expect(logSpy).toBeCalledWith("WARN", "ENDPOINT_START", {
        message: `Workflow URL contains localhost. This can happen in local development, but shouldn't happen in production unless you have a route which contains localhost. Received: ${url}`,
      });
    });
  });

  test("should forward client headers", async () => {
    const request = getRequest(WORKFLOW_ENDPOINT, "wfr-bar", "my-payload", []);
    let called = false;
    const myFailureFunction: WorkflowServeOptions["failureFunction"] = async () => {
      return;
    };

    const header = "test-header";
    const headerValue = `test-header-value-${nanoid()}`;
    const qstashClient = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token,
      headers: {
        [header]: headerValue,
      },
    });

    const { handler: endpoint } = serve(
      async (context) => {
        await context.sleep("sleep-step", 1);
      },
      {
        qstashClient,
        receiver: undefined,
        failureFunction: myFailureFunction,
      }
    );
    await mockQStashServer({
      execute: async () => {
        const response = await endpoint(request);
        expect(response.status).toBe(200);
        called = true;
      },
      responseFields: { body: { messageId: "some-message-id" }, status: 200 },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-workflow-sdk-version": "1",
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody",
              "upstash-delay": "1s",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
              "upstash-failure-callback-workflow-calltype": "failureCall",
              "upstash-failure-callback-workflow-init": "false",
              "upstash-failure-callback-workflow-runid": "wfr-bar",
              "upstash-failure-callback-workflow-url": "https://requestcatcher.com/api",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": "wfr-bar",
              "upstash-workflow-url": WORKFLOW_ENDPOINT,
              "upstash-failure-callback": WORKFLOW_ENDPOINT,
              "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
              "upstash-forward-test-header": headerValue,
              "upstash-telemetry-framework": "unknown",
              "upstash-telemetry-runtime": "unknown",
              "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
            },
            body: '{"stepId":1,"stepName":"sleep-step","stepType":"SleepFor","sleepFor":1,"concurrent":1}',
          },
        ],
      },
    });
    expect(called).toBeTrue();
  });
});
