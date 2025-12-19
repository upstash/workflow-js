/* eslint-disable @typescript-eslint/no-magic-numbers */
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { nanoid } from "./utils";

import {
  handleThirdPartyCallResult,
  recreateUserHeaders,
  triggerFirstInvocation,
  triggerRouteFunction,
  triggerWorkflowDelete,
} from "./workflow-requests";
import { WorkflowAbort, WorkflowNonRetryableError, WorkflowRetryAfterError } from "./error";
import { WorkflowContext } from "./context";
import { Client } from "@upstash/qstash";
import { Client as WorkflowClient } from "./client";
import type { Step, StepType } from "./types";
import {
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_FEATURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "./constants";
import {
  MOCK_QSTASH_SERVER_URL,
  MOCK_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
} from "./test-utils";
import { FinishState } from "./integration.test";
import { getHeaders } from "./qstash/headers";
import { LazyCallStep, LazyFunctionStep, LazyWaitForEventStep } from "./context/steps";

describe("Workflow Requests", () => {
  test("should preserve WORKFLOW_LABEL_HEADER in recreateUserHeaders", () => {
    const headers = new Headers();
    headers.append("Upstash-Workflow-Other-Header", "value1");
    headers.append("My-Header", "value2");
    headers.append("upstash-label", "my-label");

    const newHeaders = recreateUserHeaders(headers as Headers);

    expect(newHeaders.get("Upstash-Workflow-Other-Header")).toBe(null);
    expect(newHeaders.get("My-Header")).toBe("value2");
    expect(newHeaders.get("upstash-label")).toBe("my-label");
  });

  test("should propagate label from trigger options to context and headers", async () => {
    const workflowRunId = nanoid();
    const initialPayload = nanoid();
    const token = "myToken";
    const label = "test-label";

    const context = new WorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
      workflowRunId: workflowRunId,
      initialPayload,
      headers: new Headers({ "upstash-label": label }) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
      retries: 0,
      retryDelay: "1000 * retried",
      label,
    });

    expect(context.label).toBe(label);
    expect(context.headers.get("upstash-label")).toBe(label);

    await mockQStashServer({
      execute: async () => {
        const result = await triggerFirstInvocation({ workflowContext: context });
        expect(result.isOk()).toBeTrue();
      },
      responseFields: {
        body: [{ messageId: "msgId" }],
        status: 200,
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          expect.objectContaining({
            headers: expect.objectContaining({
              "upstash-label": label,
              "upstash-forward-upstash-label": label,
            }),
          }),
        ],
      },
    });
  });
  test("should send first invocation request", async () => {
    const workflowRunId = nanoid();
    const initialPayload = nanoid();
    const token = "myToken";

    const context = new WorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
      workflowRunId: workflowRunId,
      initialPayload,
      headers: new Headers({}) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
      retries: 0,
      retryDelay: "1000 * retried",
    });

    await mockQStashServer({
      execute: async () => {
        const result = await triggerFirstInvocation({ workflowContext: context });
        expect(result.isOk()).toBeTrue();
      },
      responseFields: {
        body: [{ messageId: "msgId" }],
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
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "0",
              "upstash-retry-delay": "1000 * retried",
              "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
              "upstash-telemetry-sdk": expect.stringMatching(/upstash-qstash-js@/),
              "upstash-workflow-init": "true",
              "upstash-workflow-runid": workflowRunId,
              "upstash-workflow-sdk-version": "1",
              "upstash-workflow-url": WORKFLOW_ENDPOINT,
            },
            body: initialPayload,
          },
        ],
      },
    });
  });

  describe("triggerRouteFunction", () => {
    test("should get step-finished when WorkflowAbort is thrown", async () => {
      const result = await triggerRouteFunction({
        onStep: () => {
          throw new WorkflowAbort("name");
        },
        onCleanup: async () => {
          await Promise.resolve();
        },
        onCancel: () => {
          throw new Error("Something went wrong!");
        },
      });
      expect(result.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(result.value).toBe("step-finished");
    });

    test("should get workflow-finished when no error is thrown", async () => {
      const result = await triggerRouteFunction({
        onStep: async () => {
          await Promise.resolve();
        },
        onCleanup: async () => {
          await Promise.resolve();
        },
        onCancel: () => {
          throw new Error("Something went wrong!");
        },
      });
      expect(result.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(result.value).toBe("workflow-finished");
    });

    test("should get Err if onStep throws error", async () => {
      const result = await triggerRouteFunction({
        onStep: () => {
          throw new Error("Something went wrong!");
        },
        onCleanup: async () => {
          await Promise.resolve();
        },
        onCancel: () => {
          throw new Error("Something went wrong!");
        },
      });
      expect(result.isErr()).toBeTrue();
    });

    test("should get Err if onCleanup throws error", async () => {
      const result = await triggerRouteFunction({
        onStep: async () => {
          await Promise.resolve();
        },
        onCleanup: () => {
          throw new Error("Something went wrong!");
        },
        onCancel: () => {
          throw new Error("Something went wrong!");
        },
      });
      expect(result.isErr()).toBeTrue();
    });
  });

  test("should call onCancel if context.cancel is called", async () => {
    const workflowRunId = nanoid();
    const token = "myToken";

    const context = new WorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token }),
      workflowRunId: workflowRunId,
      initialPayload: undefined,
      headers: new Headers({}) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
    });

    const finished = new FinishState();
    const result = await triggerRouteFunction({
      onStep: async () => {
        await context.cancel();
        await context.run("shouldn't call", () => {
          throw new Error("shouldn't call context.run");
        });
      },
      onCleanup: async () => {
        throw new Error("shouldn't call");
      },
      onCancel: async () => {
        finished.finish();
      },
    });
    finished.check();
    expect(result.isOk()).toBeTrue();
    // @ts-expect-error value will be set since result isOk
    expect(result.value).toBe("workflow-finished");
  });

  test("should fail workflow and return ok if WorkflowNonRetryableError is thrown", async () => {
    const result = await triggerRouteFunction({
      onStep: async () => {
        throw new WorkflowNonRetryableError("This is a non-retryable error");
      },
      onCleanup: async () => {
        throw new Error("shouldn't call");
      },
      onCancel: async () => {
        throw new Error("shouldn't call");
      },
    });
    expect(result.isOk()).toBeTrue();
    // @ts-expect-error value will be set since result isOk
    expect(result.value).toBeInstanceOf(WorkflowNonRetryableError);
  });

  test("should retry workflow and return ok if WorkflowRetryAfterError is thrown", async () => {
    const result = await triggerRouteFunction({
      onStep: async () => {
        throw new WorkflowRetryAfterError("This is a retry-after error", 5);
      },
      onCleanup: async () => {
        throw new Error("shouldn't call");
      },
      onCancel: async () => {
        throw new Error("shouldn't call");
      },
    });
    expect(result.isOk()).toBeTrue();
    // @ts-expect-error value will be set since result isOk
    expect(result.value).toBeInstanceOf(WorkflowRetryAfterError);
    // @ts-expect-error value will be set since result isOk
    expect(result.value.retryAfter).toBe(5);
  });

  test("should call onCancel if context.cancel is called inside context.run", async () => {
    const workflowRunId = nanoid();
    const token = "myToken";

    const context = new WorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token }),
      workflowRunId: workflowRunId,
      initialPayload: undefined,
      headers: new Headers({}) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
    });

    const finished = new FinishState();
    const result = await triggerRouteFunction({
      onStep: async () => {
        await context.run("should call cancel", async () => {
          await context.cancel();
        });
      },
      onCleanup: async () => {
        throw new Error("shouldn't call");
      },
      onCancel: async () => {
        finished.finish();
      },
    });
    finished.check();
    expect(result.isOk()).toBeTrue();
    // @ts-expect-error value will be set since result isOk
    expect(result.value).toBe("workflow-finished");
  });

  test("should call publishJSON in triggerWorkflowDelete", async () => {
    const workflowRunId = nanoid();
    const token = "myToken";

    const context = new WorkflowContext({
      qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token }),
      workflowRunId: workflowRunId,
      initialPayload: undefined,
      headers: new Headers({}) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
    });

    const spy = spyOn(context.qstashClient.http, "request");
    await triggerWorkflowDelete(context, "hello world");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({
      path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=false`],
      body: '"hello world"',
      method: "DELETE",
      parseResponseAsJson: false,
    });
  });

  test("should remove workflow headers in recreateUserHeaders", () => {
    const headers = new Headers();
    headers.append("Upstash-Workflow-Other-Header", "value1");
    headers.append("My-Header", "value2");

    const newHeaders = recreateUserHeaders(headers as Headers);

    expect(newHeaders.get("Upstash-Workflow-Other-Header")).toBe(null);
    expect(newHeaders.get("My-Header")).toBe("value2");
  });

  describe("handleThirdPartyCallResult", () => {
    test("should POST third party call results in is-call-return case", async () => {
      // request parameters
      const thirdPartyCallResult = "third-party-call-result";
      const requestPayload = { status: 200, body: btoa(thirdPartyCallResult) };
      const stepName = "test step";
      const stepType: StepType = "Run";
      const workflowRunId = nanoid();

      // create client
      const token = nanoid();
      const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

      // create the request which will be received by the serve method:
      const request = new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestPayload),
        headers: new Headers({
          "Upstash-Workflow-Callback": "true",
          "Upstash-Workflow-StepId": "3",
          "Upstash-Workflow-StepName": stepName,
          "Upstash-Workflow-StepType": stepType,
          "Upstash-Workflow-Concurrent": "1",
          "Upstash-Workflow-ContentType": "application/json",
          [WORKFLOW_ID_HEADER]: workflowRunId,
        }),
      });

      // create mock server and run the code
      await mockQStashServer({
        execute: async () => {
          const result = await handleThirdPartyCallResult({
            request,
            requestPayload: await request.text(),
            client,
            workflowUrl: WORKFLOW_ENDPOINT,
            failureUrl: WORKFLOW_ENDPOINT,
            retries: 2,
            retryDelay: "1000",
            telemetry: {
              framework: "some-platform",
              sdk: "some-sdk",
            },
          });
          expect(result.isOk()).toBeTrue();
          // @ts-expect-error value will be set since stepFinish isOk
          expect(result.value).toBe("is-call-return");
        },
        responseFields: {
          body: { messageId: "msgId" },
          status: 200,
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
          token,
          body: {
            stepId: 3,
            stepName: stepName,
            stepType: stepType,
            out: '{"status":200,"body":"third-party-call-result"}',
            concurrent: 1,
          },
          headers: {
            "upstash-retries": "2",
            "upstash-retry-delay": "1000",
            "upstash-failure-callback": WORKFLOW_ENDPOINT,
          },
        },
      });
    });

    test("should do nothing in call-will-retry case", async () => {
      // in this test, the SDK receives a request with "Upstash-Workflow-Callback": "true"
      // but the status is not OK, so we have to do nothing return `call-will-retry`

      // request parameters
      const thirdPartyCallResult = "third-party-call-result";

      // status set to 404 which should make QStash retry. workflow sdk should do nothing
      // in this case
      const requestPayload = {
        status: 404,
        body: btoa(thirdPartyCallResult),
        maxRetries: 3,
        retried: 1,
      };
      const stepName = "test step";
      const stepType: StepType = "Run";
      const workflowRunId = nanoid();

      // create client
      const token = "myToken";
      const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

      // create the request which will be received by the serve method:
      const request = new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestPayload),
        headers: new Headers({
          "Upstash-Workflow-Callback": "true",
          "Upstash-Workflow-StepId": "3",
          "Upstash-Workflow-StepName": stepName,
          "Upstash-Workflow-StepType": stepType,
          "Upstash-Workflow-Concurrent": "1",
          "Upstash-Workflow-ContentType": "application/json",
          [WORKFLOW_ID_HEADER]: workflowRunId,
        }),
      });

      const spy = spyOn(client, "publishJSON");
      const result = await handleThirdPartyCallResult({
        request,
        requestPayload: await request.text(),
        client,
        workflowUrl: WORKFLOW_ENDPOINT,
        failureUrl: WORKFLOW_ENDPOINT,
        retries: 3,
        retryDelay: "1000",
        telemetry: {
          framework: "some-platform",
          sdk: "some-sdk",
        },
      });
      expect(result.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(result.value).toBe("call-will-retry");
      expect(spy).toHaveBeenCalledTimes(0);
    });

    test("should do nothing in continue-workflow case", async () => {
      // payload is a list of steps
      const initialPayload = "my-payload";
      const requestPayload: Step[] = [
        {
          stepId: 1,
          stepName: "step name",
          stepType: "Run",
          concurrent: 1,
        },
      ];
      const workflowRunId = nanoid();

      // create client
      const token = "myToken";
      const client = new Client({ baseUrl: MOCK_SERVER_URL, token });

      // create the request which will be received by the serve method:
      const initialRequest = new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: initialPayload,
        headers: new Headers({}),
      });

      const workflowRequest = new Request(WORKFLOW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify([initialPayload, requestPayload]),
        headers: new Headers({
          [WORKFLOW_INIT_HEADER]: "false",
          [WORKFLOW_ID_HEADER]: workflowRunId,
          [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
          [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
        }),
      });

      const spy = spyOn(client, "publishJSON");
      const initialResult = await handleThirdPartyCallResult({
        request: initialRequest,
        requestPayload: await initialRequest.text(),
        client,
        workflowUrl: WORKFLOW_ENDPOINT,
        failureUrl: WORKFLOW_ENDPOINT,
        retries: 5,
        retryDelay: "1000",
        telemetry: {
          framework: "some-platform",
          sdk: "some-sdk",
        },
      });
      expect(initialResult.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(initialResult.value).toBe("continue-workflow");
      expect(spy).toHaveBeenCalledTimes(0);

      // second call
      const result = await handleThirdPartyCallResult({
        request: workflowRequest,
        requestPayload: await workflowRequest.text(),
        client,
        workflowUrl: WORKFLOW_ENDPOINT,
        failureUrl: WORKFLOW_ENDPOINT,
        retries: 0,
        telemetry: {
          framework: "some-platform",
          sdk: "some-sdk",
        },
      });
      expect(result.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(result.value).toBe("continue-workflow");
      expect(spy).toHaveBeenCalledTimes(0);
    });
  });

  describe("getHeaders", () => {
    const workflowRunId = nanoid();
    test("should create headers without step passed", () => {
      const { headers } = getHeaders({
        initHeaderValue: "true",
        workflowConfig: {
          workflowRunId,
          workflowUrl: WORKFLOW_ENDPOINT,
          flowControl: {
            key: "initial-key",
            parallelism: 2,
          },
        },
        userHeaders: new Headers() as Headers,
      });
      expect(headers).toEqual({
        [WORKFLOW_INIT_HEADER]: "true",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody,WF_DetectTrigger",
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
        "content-type": "application/json",
        "Upstash-Flow-Control-Key": "initial-key",
        "Upstash-Flow-Control-Value": "parallelism=2",
      });
    });

    test("should create headers with a result step", async () => {
      const stepId = 3;
      const stepName = "some step";
      const mockContext = new WorkflowContext({
        qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token: "myToken" }),
        workflowRunId: "test-run-id",
        headers: new Headers() as Headers,
        steps: [],
        url: WORKFLOW_ENDPOINT,
        initialPayload: undefined,
      });

      const lazyStep = new LazyFunctionStep(mockContext, stepName, () => {});
      const { headers } = getHeaders({
        initHeaderValue: "false",
        workflowConfig: {
          workflowRunId,
          workflowUrl: WORKFLOW_ENDPOINT,
          flowControl: {
            key: "step-key",
            ratePerSecond: 3,
          },
        },
        stepInfo: {
          step: await lazyStep.getResultStep(1, stepId),
          lazyStep,
        },
        userHeaders: new Headers() as Headers,
      });

      expect(headers).toEqual({
        [WORKFLOW_INIT_HEADER]: "false",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody,WF_DetectTrigger",
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
        "content-type": "application/json",
        "Upstash-Flow-Control-Key": "step-key",
        "Upstash-Flow-Control-Value": "rate=3",
      });
    });

    test("should create headers with a call step", async () => {
      const stepId = 3;
      const stepName = "some step";
      const callUrl = "https://www.some-call-endpoint.com/api";
      const callMethod = "GET";
      const callHeaders = {
        "my-custom-header": "my-custom-header-value",
      };
      const callBody = undefined;

      const mockContext = new WorkflowContext({
        qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token: "myToken" }),
        workflowRunId,
        headers: new Headers() as Headers,
        steps: [],
        url: WORKFLOW_ENDPOINT,
        initialPayload: undefined,
        flowControl: {
          key: "regular-flow-key",
          rate: 3,
          parallelism: 4,
          period: "1m",
        },
      });
      const lazyStep = new LazyCallStep(
        mockContext,
        stepName,
        callUrl,
        callMethod,
        callBody,
        callHeaders,
        0,
        undefined,
        undefined,
        {
          key: "call-flow-key",
          rate: 5,
          parallelism: 6,
          period: 30,
        },
        true
      );
      const { headers } = lazyStep.getHeaders({
        context: mockContext,
        invokeCount: 3,
        step: await lazyStep.getResultStep(1, stepId),
      });
      expect(headers).toEqual({
        [WORKFLOW_INIT_HEADER]: "false",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete,InitialBody",
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        "Upstash-Callback-Forward-Upstash-Workflow-Invoke-Count": "3",
        "Upstash-Forward-Upstash-Workflow-Invoke-Count": "3",
        "Upstash-Callback-Feature-Set": "LazyFetch,InitialBody,WF_DetectTrigger",
        "Upstash-Retries": "0",
        "Upstash-Callback": WORKFLOW_ENDPOINT,
        "Upstash-Callback-Forward-Upstash-Workflow-Callback": "true",
        "Upstash-Callback-Forward-Upstash-Workflow-Concurrent": "1",
        "Upstash-Callback-Forward-Upstash-Workflow-ContentType": "application/json",
        "Upstash-Callback-Forward-Upstash-Workflow-StepId": stepId.toString(),
        "Upstash-Callback-Forward-Upstash-Workflow-StepName": stepName,
        "Upstash-Callback-Forward-Upstash-Workflow-StepType": "Call",
        "Upstash-Callback-Workflow-CallType": "fromCallback",
        "Upstash-Callback-Workflow-RunId": workflowRunId,
        "Upstash-Callback-Workflow-Init": "false",
        "Upstash-Callback-Workflow-Url": WORKFLOW_ENDPOINT,
        "Upstash-Forward-my-custom-header": "my-custom-header-value",
        "Upstash-Workflow-CallType": "toCallback",
        "content-type": "application/json",
        // flow control:
        "Upstash-Callback-Flow-Control-Key": "regular-flow-key",
        "Upstash-Callback-Flow-Control-Value": "parallelism=4, rate=3, period=1m",
        "Upstash-Flow-Control-Key": "call-flow-key",
        "Upstash-Flow-Control-Value": "parallelism=6, rate=5, period=30s",
      });
    });

    test("should include failure header", () => {
      const failureUrl = "https://my-failure-endpoint.com";
      const { headers } = getHeaders({
        initHeaderValue: "true",
        workflowConfig: {
          workflowRunId,
          workflowUrl: WORKFLOW_ENDPOINT,
          failureUrl,
          flowControl: {
            key: "failure-key",
            parallelism: 2,
          },
          retries: 6,
          retryDelay: "1000",
        },
        userHeaders: new Headers() as Headers,
      });
      expect(headers).toEqual({
        [WORKFLOW_INIT_HEADER]: "true",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody,WF_DetectTrigger",
        "Upstash-Failure-Callback-Feature-Set": "LazyFetch,InitialBody,WF_DetectTrigger",
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
        [`Upstash-Failure-Callback-Forward-${WORKFLOW_FAILURE_HEADER}`]: "true",
        "Upstash-Failure-Callback-Forward-Upstash-Workflow-Failure-Callback": "true",
        "Upstash-Failure-Callback-Workflow-Calltype": "failureCall",
        "Upstash-Failure-Callback-Workflow-Init": "false",
        "Upstash-Failure-Callback-Workflow-Runid": workflowRunId,
        "Upstash-Failure-Callback-Workflow-Url": "https://requestcatcher.com/api",
        "Upstash-Failure-Callback": failureUrl,
        "content-type": "application/json",
        "Upstash-Failure-Callback-Flow-Control-Key": "failure-key",
        "Upstash-Failure-Callback-Flow-Control-Value": "parallelism=2",
        "Upstash-Flow-Control-Key": "failure-key",
        "Upstash-Flow-Control-Value": "parallelism=2",
        "Upstash-Failure-Callback-Retries": "6",
        "Upstash-Failure-Callback-Retry-Delay": "1000",
        "Upstash-Retries": "6",
        "Upstash-Retry-Delay": "1000",
      });
    });

    test("should return timeout headers for wait step", async () => {
      const context = new WorkflowContext({
        headers: new Headers() as Headers,
        initialPayload: undefined,
        qstashClient: new Client({ baseUrl: MOCK_SERVER_URL, token: "token" }),
        steps: [],
        url: WORKFLOW_ENDPOINT,
        workflowRunId,
        flowControl: {
          key: "wait-key",
          parallelism: 2,
        },
      });
      const lazyStep = new LazyWaitForEventStep(
        context,
        "waiting-step-name",
        "wait event id",
        "20s"
      );

      const step = await lazyStep.getResultStep(1, 1);
      const { headers } = lazyStep.getHeaders({
        context,
        step,
        invokeCount: 0,
      });
      const body = lazyStep.getBody({
        context,
        headers,
        invokeCount: 0,
        step,
      });
      expect(headers).toEqual({
        "Upstash-Workflow-Init": "false",
        "Upstash-Workflow-RunId": workflowRunId,
        "Upstash-Workflow-Url": WORKFLOW_ENDPOINT,
        [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody,WF_DetectTrigger",
        "Upstash-Forward-Upstash-Workflow-Sdk-Version": "1",
        "Upstash-Workflow-CallType": "step",
        "content-type": "application/json",
        "Upstash-Flow-Control-Key": "wait-key",
        "Upstash-Flow-Control-Value": "parallelism=2",
      });
      expect(typeof body).toBe("string");
      expect(JSON.parse(body)).toEqual({
        url: "https://requestcatcher.com/api",
        timeout: "20s",
        timeoutUrl: "https://requestcatcher.com/api",
        timeoutHeaders: {
          "Upstash-Workflow-Init": ["false"],
          "Upstash-Workflow-RunId": [workflowRunId],
          "Upstash-Workflow-Url": [WORKFLOW_ENDPOINT],
          [WORKFLOW_FEATURE_HEADER]: ["LazyFetch,InitialBody,WF_DetectTrigger"],
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: [WORKFLOW_PROTOCOL_VERSION],
          "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
          "content-type": ["application/json"],
          "Upstash-Flow-Control-Key": ["wait-key"],
          "Upstash-Flow-Control-Value": ["parallelism=2"],
          "Upstash-Workflow-CallType": ["step"],
          "Upstash-Workflow-Runid": [workflowRunId],
        },
        step: { stepId: 1, stepType: "Wait", stepName: "waiting-step-name", concurrent: 1 },
      });
    });
  });

  describe("should omit some errors", () => {
    const qstashClient = new Client({
      token: process.env.QSTASH_TOKEN!,
    });

    const workflowClient = new WorkflowClient({ token: process.env.QSTASH_TOKEN! });

    afterAll(async () => {
      await workflowClient.cancel({ urlStartingWith: WORKFLOW_ENDPOINT });
    });

    test(
      "should omit the error if the triggerWorkflowDelete fails with workflow run doesn't exist",
      async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const context = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [],
          url: WORKFLOW_ENDPOINT,
        });

        await triggerFirstInvocation({ workflowContext: context });

        const firstDelete = await triggerWorkflowDelete(context, "hello world");
        expect(firstDelete).toEqual(undefined);
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should omit if triggerRouteFunction gets can't publish to canceled workflow error",
      async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const context = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [],
          url: WORKFLOW_ENDPOINT,
        });

        await triggerFirstInvocation({
          workflowContext: context,
          useJSONContent: false,
        });

        const warnSpy = spyOn(console, "warn");

        await workflowClient.cancel({ ids: [workflowRunId] });

        const result = await triggerRouteFunction({
          onStep: async () => {
            await context.sleep("sleeping", 10);
          },
          onCleanup: async () => {
            throw new Error("shouldn't come here.");
          },
          onCancel: async () => {
            throw new Error("shouldn't come here.");
          },
        });

        expect(result.isOk()).toBeTrue();
        // @ts-expect-error value will be set since stepFinish isOk
        expect(result.value).toBe("workflow-was-finished");

        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.mock.calls;
        const cancelledWarning = warnCalls.find((call: string[]) =>
          call[0]?.includes("Tried to append to a cancelled workflow")
        );
        expect(cancelledWarning).toBeDefined();
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should omit if triggerRouteFunction (with parallel steps) gets can't publish to canceled workflow error",
      async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const context = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [],
          url: WORKFLOW_ENDPOINT,
        });

        await triggerFirstInvocation({
          workflowContext: context,
          useJSONContent: false,
        });

        await workflowClient.cancel({ ids: [workflowRunId] });

        const result = await triggerRouteFunction({
          onStep: async () => {
            await Promise.all([context.sleep("sleeping", 10), context.sleep("sleeping", 10)]);
          },
          onCleanup: async () => {
            throw new Error("shouldn't come here.");
          },
          onCancel: async () => {
            throw new Error("shouldn't come here.");
          },
        });

        expect(result.isOk()).toBeTrue();
        // @ts-expect-error value will be set since stepFinish isOk
        expect(result.value).toBe("workflow-was-finished");
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should omit if triggerRouteFunction (with partial parallel step execution) gets can't publish to canceled workflow error",
      async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const context = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [
            {
              stepId: 0,
              concurrent: 1,
              stepName: "init",
              stepType: "Initial",
              targetStep: 1,
            },
            {
              stepId: 0,
              concurrent: 2,
              stepName: "sleeping",
              stepType: "SleepFor",
              targetStep: 1,
            },
          ],
          url: WORKFLOW_ENDPOINT,
        });

        await triggerFirstInvocation({ workflowContext: context, useJSONContent: false });

        await workflowClient.cancel({ ids: [workflowRunId] });

        const warnSpy = spyOn(console, "warn");

        const result = await triggerRouteFunction({
          onStep: async () => {
            await Promise.all([context.sleep("sleeping", 10), context.sleep("sleeping", 10)]);
          },
          onCleanup: async () => {
            throw new Error("shouldn't come here.");
          },
          onCancel: async () => {
            throw new Error("shouldn't come here.");
          },
        });

        expect(result.isOk()).toBeTrue();
        // @ts-expect-error value will be set since stepFinish isOk
        expect(result.value).toBe("workflow-was-finished");

        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.mock.calls;
        const cancelledWarning = warnCalls.find((call) =>
          call[0]?.includes("Tried to append to a cancelled workflow")
        );
        expect(cancelledWarning).toBeDefined();
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should omit the error if the workflow is created with the same id",
      async () => {
        const workflowRunId = `wfr-${nanoid()}`;
        const context = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [],
          url: WORKFLOW_ENDPOINT,
        });

        const resultOne = await triggerFirstInvocation({
          workflowContext: context,
          useJSONContent: false,
        });
        expect(resultOne.isOk()).toBeTrue();
        // @ts-expect-error value will exist because of isOk
        expect(resultOne.value).toBe("success");

        const warnSpy = spyOn(console, "warn");

        const noRetryContext = new WorkflowContext({
          qstashClient,
          workflowRunId: workflowRunId,
          initialPayload: undefined,
          headers: new Headers({}) as Headers,
          steps: [],
          url: WORKFLOW_ENDPOINT,
          retries: 0,
        });
        const resultTwo = await triggerFirstInvocation({
          workflowContext: noRetryContext,
          useJSONContent: false,
        });
        expect(resultTwo.isOk()).toBeTrue();
        // @ts-expect-error value will exist because of isOk
        expect(resultTwo.value).toBe("workflow-run-already-exists");

        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.mock.calls;
        const duplicateWarning = warnCalls.find((call) =>
          call[0]?.includes(`Workflow run ${workflowRunId} already exists`)
        );
        expect(duplicateWarning).toBeDefined();

        const deleteResult = await triggerWorkflowDelete(context, undefined);
        expect(deleteResult).toEqual(undefined);

        const deleteResultSecond = await triggerWorkflowDelete(noRetryContext, undefined);
        expect(deleteResultSecond).toEqual(undefined);
      },
      {
        timeout: 10000,
      }
    );
  });
});
