/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, expect, spyOn, test } from "bun:test";
import { nanoid } from "./utils";

import {
  getHeaders,
  handleThirdPartyCallResult,
  recreateUserHeaders,
  triggerFirstInvocation,
  triggerRouteFunction,
  triggerWorkflowDelete,
} from "./workflow-requests";
import { QStashWorkflowAbort } from "./error";
import { WorkflowContext } from "./context";
import { Client } from "@upstash/qstash";
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

describe("Workflow Requests", () => {
  test("triggerFirstInvocation", async () => {
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
    });

    await mockQStashServer({
      execute: async () => {
        const result = await triggerFirstInvocation(context, 0);
        expect(result.isOk()).toBeTrue();
      },
      responseFields: {
        body: { messageId: "msgId" },
        status: 200,
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/https://www.my-website.com/api`,
        token,
        body: initialPayload,
        headers: {
          "upstash-retries": "0",
        },
      },
    });
  });

  describe("triggerRouteFunction", () => {
    test("should get step-finished when QStashWorkflowAbort is thrown", async () => {
      const result = await triggerRouteFunction({
        onStep: () => {
          throw new QStashWorkflowAbort("name");
        },
        onCleanup: async () => {
          await Promise.resolve();
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
      });
      expect(result.isErr()).toBeTrue();
    });
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
    await triggerWorkflowDelete(context);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({
      path: ["v2", "workflows", "runs", `${workflowRunId}?cancel=false`],
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
          const result = await handleThirdPartyCallResult(
            request,
            await request.text(),
            client,
            WORKFLOW_ENDPOINT,
            WORKFLOW_ENDPOINT,
            2
          );
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
      const result = await handleThirdPartyCallResult(
        request,
        await request.text(),
        client,
        WORKFLOW_ENDPOINT,
        WORKFLOW_ENDPOINT,
        3
      );
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
      const initialResult = await handleThirdPartyCallResult(
        initialRequest,
        await initialRequest.text(),
        client,
        WORKFLOW_ENDPOINT,
        WORKFLOW_ENDPOINT,
        5
      );
      expect(initialResult.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(initialResult.value).toBe("continue-workflow");
      expect(spy).toHaveBeenCalledTimes(0);

      // second call
      const result = await handleThirdPartyCallResult(
        workflowRequest,
        await workflowRequest.text(),
        client,
        WORKFLOW_ENDPOINT,
        WORKFLOW_ENDPOINT,
        0
      );
      expect(result.isOk()).toBeTrue();
      // @ts-expect-error value will be set since stepFinish isOk
      expect(result.value).toBe("continue-workflow");
      expect(spy).toHaveBeenCalledTimes(0);
    });
  });

  describe("getHeaders", () => {
    const workflowRunId = nanoid();
    test("should create headers without step passed", () => {
      const { headers, timeoutHeaders } = getHeaders("true", workflowRunId, WORKFLOW_ENDPOINT);
      expect(headers).toEqual({
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete",
        [WORKFLOW_INIT_HEADER]: "true",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
      });
      expect(timeoutHeaders).toBeUndefined();
    });

    test("should create headers with a result step", () => {
      const stepId = 3;
      const stepName = "some step";
      const stepType: StepType = "Run";

      const { headers, timeoutHeaders } = getHeaders(
        "false",
        workflowRunId,
        WORKFLOW_ENDPOINT,
        undefined,
        {
          stepId,
          stepName,
          stepType: stepType,
          concurrent: 1,
        }
      );
      expect(headers).toEqual({
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete",
        [WORKFLOW_INIT_HEADER]: "false",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
      });
      expect(timeoutHeaders).toBeUndefined();
    });

    test("should create headers with a call step", () => {
      const stepId = 3;
      const stepName = "some step";
      const stepType: StepType = "Call";
      const callUrl = "https://www.some-call-endpoint.com/api";
      const callMethod = "GET";
      const callHeaders = {
        "my-custom-header": "my-custom-header-value",
      };
      const callBody = undefined;

      const { headers, timeoutHeaders } = getHeaders(
        "false",
        workflowRunId,
        WORKFLOW_ENDPOINT,
        undefined,
        {
          stepId,
          stepName,
          stepType: stepType,
          concurrent: 1,
          callUrl,
          callMethod,
          callHeaders,
          callBody,
        }
      );
      expect(headers).toEqual({
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete",
        [WORKFLOW_INIT_HEADER]: "false",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
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
      });
      expect(timeoutHeaders).toBeUndefined();
    });

    test("should include failure header", () => {
      const failureUrl = "https://my-failure-endpoint.com";
      const { headers, timeoutHeaders } = getHeaders(
        "true",
        workflowRunId,
        WORKFLOW_ENDPOINT,
        new Headers() as Headers,
        undefined,
        failureUrl
      );
      expect(headers).toEqual({
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete",
        [WORKFLOW_INIT_HEADER]: "true",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_URL_HEADER]: WORKFLOW_ENDPOINT,
        [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: WORKFLOW_PROTOCOL_VERSION,
        [`Upstash-Failure-Callback-Forward-${WORKFLOW_FAILURE_HEADER}`]: "true",
        "Upstash-Failure-Callback": failureUrl,
      });
      expect(timeoutHeaders).toBeUndefined();
    });

    test("should return timeout headers for wait step", () => {
      const { headers, timeoutHeaders } = getHeaders(
        "false",
        workflowRunId,
        WORKFLOW_ENDPOINT,
        undefined,
        {
          stepId: 1,
          stepName: "waiting-step-name",
          stepType: "Wait",
          concurrent: 1,
          waitEventId: "wait event id",
          timeout: "20s",
        }
      );
      expect(headers).toEqual({
        [WORKFLOW_FEATURE_HEADER]: "WF_NoDelete",
        "Upstash-Workflow-Init": "false",
        "Upstash-Workflow-RunId": workflowRunId,
        "Upstash-Workflow-Url": WORKFLOW_ENDPOINT,
        "Upstash-Forward-Upstash-Workflow-Sdk-Version": "1",
        "Upstash-Workflow-CallType": "step",
      });
      expect(timeoutHeaders).toEqual({
        [WORKFLOW_FEATURE_HEADER]: ["WF_NoDelete"],
        "Upstash-Workflow-Init": ["false"],
        "Upstash-Workflow-RunId": [workflowRunId],
        "Upstash-Workflow-Url": [WORKFLOW_ENDPOINT],
        "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
        "Upstash-Workflow-Runid": [workflowRunId],
        "Upstash-Workflow-CallType": ["step"],
        "Content-Type": ["application/json"],
      });
    });
  });
});
