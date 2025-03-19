import { describe, expect, test } from "bun:test";
import { createWorkflow, serveMany } from "../../platforms/nextjs";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import {
  getRequest,
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
} from "../test-utils";
import { nanoid } from "../utils";
import { WORKFLOW_INVOKE_COUNT_HEADER } from "../constants";
import { Telemetry } from "../types";
import { getNewUrlFromWorkflowId, invokeWorkflow } from "./serve-many";

describe("serveMany", () => {
  describe("invokeWorkflow", () => {
    test("should call invokeWorkflow", async () => {
      const token = nanoid();

      const telemetry: Telemetry = {
        sdk: "sdk",
        framework: "framework",
        runtime: "runtime",
      };
      const workflowId = "some-workflow-id";

      await mockQStashServer({
        execute: async () => {
          await invokeWorkflow({
            settings: {
              body: "some-body",
              workflow: {
                routeFunction: async () => {},
                workflowId,
                options: {},
              },
              headers: { custom: "custom-header-value" },
              retries: 6,
              workflowRunId: "some-run-id",
            },
            invokeCount: 0,
            invokeStep: {
              stepId: 4,
              concurrent: 1,
              stepName: "invoke-step",
              stepType: "Invoke",
            },
            context: new WorkflowContext({
              headers: new Headers({ original: "original-headers-value" }) as Headers,
              initialPayload: "initial-payload",
              qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
              steps: [],
              url: `${WORKFLOW_ENDPOINT}/original_workflow`,
              workflowRunId: "wfr_original_workflow",
            }),
            telemetry,
          });
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/${workflowId}`,
          token,
          body: {
            body: '"some-body"',
            headers: {
              "Upstash-Workflow-Init": ["false"],
              "Upstash-Workflow-RunId": ["wfr_original_workflow"],
              "Upstash-Workflow-Url": ["https://requestcatcher.com/api/original_workflow"],
              "Upstash-Forward-Upstash-Workflow-Invoke-Count": ["0"],
              "Upstash-Feature-Set": ["LazyFetch,InitialBody"],
              "Upstash-Workflow-Sdk-Version": ["1"],
              "content-type": ["application/json"],
              "Upstash-Telemetry-Sdk": ["sdk"],
              "Upstash-Telemetry-Framework": ["framework"],
              "Upstash-Telemetry-Runtime": ["runtime"],
              "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
              "Upstash-Retries": ["3"],
              "Upstash-Failure-Callback-Retries": ["3"],
              "Upstash-Forward-original": ["original-headers-value"],
              "Upstash-Failure-Callback-Forward-original": ["original-headers-value"],
              "Upstash-Workflow-Runid": ["wfr_original_workflow"],
            },
            workflowRunId: "wfr_original_workflow",
            workflowUrl: "https://requestcatcher.com/api/original_workflow",
            step: {
              stepId: 4,
              concurrent: 1,
              stepName: "invoke-step",
              stepType: "Invoke",
            },
          },
          headers: {
            "upstash-retries": "6",
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "1",
            [`Upstash-Forward-custom`]: "custom-header-value",
            "Upstash-Forward-original": null,
          },
        },
      });
    });
  });

  describe("serveMany", () => {
    test("should throw if workflowId contains '/'", () => {
      const throws = () =>
        serveMany({
          "workflow/one": createWorkflow(async () => {}),
        });
      expect(throws).toThrow(
        "Invalid workflow name found: 'workflow/one'. Workflow name cannot contain '/'."
      );
    });

    test("should throw if workflowId doesn't match", async () => {
      const { POST: handler } = serveMany({
        "workflow-one": createWorkflow(async () => {}),
      });

      const request = new Request("http://localhost:3001/workflow-two", { method: "POST" });
      const response = await handler(request);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe(
        "No workflows in serveMany found for 'workflow-two'. Please update the URL of your request."
      );
    });
  });

  describe("serve tests", () => {
    const token = nanoid();
    const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

    const workflowOne = createWorkflow(
      async (context: WorkflowContext<number>) => {
        const a = context.requestPayload + 2;
        return `result ${a}`;
      },
      {
        flowControl: {
          key: "workflowOneFlowControl",
          parallelism: 2,
          ratePerSecond: 10,
        },
      }
    );

    const workflowTwo = createWorkflow(
      async (context: WorkflowContext<string>) => {
        const result = await context.invoke("invoke step two", {
          workflow: workflowOne,
          body: 2,
          flowControl: {
            key: "customFlowControl",
            parallelism: 4,
          },
        });

        const _body = result.body;
        const _isCanceled = result.isCanceled;
        const _isFailed = result.isFailed;

        console.log(_body, _isCanceled, _isFailed);

        // just checking the type. code won't reach here.
        const secondResult = await context.invoke("invoke step two", {
          workflow: workflowOne,
          body: 2,
          flowControl: {
            key: "customFlowControl",
            parallelism: 4,
          },
        });

        const _secondBody = secondResult.body;
        const _secondIsCanceled = secondResult.isCanceled;
        const _secondIsFailed = secondResult.isFailed;

        console.log(_secondBody, _secondIsCanceled, _secondIsFailed);
      },
      {
        flowControl: {
          key: "workflowTwoFlowControl",
          parallelism: 4,
          ratePerSecond: 6,
        },
      }
    );

    const workflowThree = createWorkflow(
      async (context: WorkflowContext<string>) => {
        const result = await context.call("call other workflow", {
          workflow: workflowOne,
          body: 2,
        });

        const _body = result.body;
        const _header = result.header;
        const _status = result.status;

        console.log(_body, _header, _status);
      },
      {
        flowControl: {
          key: "workflowThreeFlowControl",
          parallelism: 4,
          ratePerSecond: 6,
        },
      }
    );

    const { POST: handler } = serveMany(
      {
        "workflow-one": workflowOne,
        "workflow-two": workflowTwo,
        "workflow-three": workflowThree,
      },
      {
        qstashClient,
        receiver: undefined,
      }
    );

    test("first invoke", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflow-two`,
        "wfr_id",
        "initial-payload",
        []
      );

      await mockQStashServer({
        execute: async () => {
          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflow-one`,
          token,
          body: {
            body: "2",
            headers: {
              "Upstash-Failure-Callback-Retries": ["3"],
              "Upstash-Forward-Upstash-Workflow-Invoke-Count": ["0"],
              "Upstash-Feature-Set": ["LazyFetch,InitialBody"],
              "Upstash-Flow-Control-Key": ["workflowTwoFlowControl"],
              "Upstash-Flow-Control-Value": ["parallelism=4, rate=6"],
              "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
              "Upstash-Retries": ["3"],
              "Upstash-Telemetry-Framework": ["nextjs"],
              "Upstash-Telemetry-Runtime": ["node@v22.6.0"],
              "Upstash-Telemetry-Sdk": ["@upstash/workflow@v0.2.7"],
              "Upstash-Workflow-Init": ["false"],
              "Upstash-Workflow-RunId": ["wfr_id"],
              "Upstash-Workflow-Runid": ["wfr_id"],
              "Upstash-Workflow-Sdk-Version": ["1"],
              "Upstash-Workflow-Url": ["https://requestcatcher.com/api/workflow-two"],
              "content-type": ["application/json"],
            },
            workflowRunId: expect.any(String),
            workflowUrl: "https://requestcatcher.com/api/workflow-two",
            step: {
              stepId: 1,
              concurrent: 1,
              stepName: "invoke step two",
              stepType: "Invoke",
            },
          },
          headers: {
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "1",
            "Upstash-Flow-Control-Key": "customFlowControl",
            "Upstash-Flow-Control-Value": "parallelism=4",
          },
        },
      });
    });

    test("should increment invoke count in second invoke", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflow-two`,
        "wfr_id",
        "initial-payload",
        []
      );
      request.headers.set(WORKFLOW_INVOKE_COUNT_HEADER, "1");

      await mockQStashServer({
        execute: async () => {
          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflow-one`,
          token,
          body: {
            body: "2",
            headers: {
              "Upstash-Failure-Callback-Retries": ["3"],
              "Upstash-Feature-Set": ["LazyFetch,InitialBody"],
              "Upstash-Forward-Upstash-Workflow-Invoke-Count": ["1"],
              "Upstash-Flow-Control-Key": ["workflowTwoFlowControl"],
              "Upstash-Flow-Control-Value": ["parallelism=4, rate=6"],
              "Upstash-Forward-Upstash-Workflow-Sdk-Version": ["1"],
              "Upstash-Retries": ["3"],
              "Upstash-Telemetry-Framework": ["nextjs"],
              "Upstash-Telemetry-Runtime": ["node@v22.6.0"],
              "Upstash-Telemetry-Sdk": ["@upstash/workflow@v0.2.7"],
              "Upstash-Workflow-Init": ["false"],
              "Upstash-Workflow-RunId": ["wfr_id"],
              "Upstash-Workflow-Runid": ["wfr_id"],
              "Upstash-Workflow-Sdk-Version": ["1"],
              "Upstash-Workflow-Url": ["https://requestcatcher.com/api/workflow-two"],
              "content-type": ["application/json"],
            },
            workflowRunId: expect.any(String),
            workflowUrl: "https://requestcatcher.com/api/workflow-two",
            step: {
              stepId: 1,
              concurrent: 1,
              stepName: "invoke step two",
              stepType: "Invoke",
            },
          },
          headers: {
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "2",
            "Upstash-Flow-Control-Key": "customFlowControl",
            "Upstash-Flow-Control-Value": "parallelism=4",
          },
        },
      });
    });

    test("should make context.call request with workflow", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflow-three`,
        "wfr_id",
        "initial-payload",
        []
      );
      request.headers.set(WORKFLOW_INVOKE_COUNT_HEADER, "1");

      await mockQStashServer({
        execute: async () => {
          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              body: "2",
              destination: "https://requestcatcher.com/api/workflow-one",
              headers: {
                "content-type": "application/json",
                "upstash-callback": "https://requestcatcher.com/api/workflow-three",
                "upstash-callback-feature-set": "LazyFetch,InitialBody",
                "upstash-callback-flow-control-key": "workflowThreeFlowControl",
                "upstash-callback-flow-control-value": "parallelism=4, rate=6",
                "upstash-flow-control-key": "workflowOneFlowControl",
                "upstash-flow-control-value": "parallelism=2, rate=10",
                "upstash-callback-forward-upstash-workflow-callback": "true",
                "upstash-callback-forward-upstash-workflow-concurrent": "1",
                "upstash-callback-forward-upstash-workflow-contenttype": "application/json",
                "upstash-callback-forward-upstash-workflow-invoke-count": "1",
                "upstash-callback-forward-upstash-workflow-stepid": "1",
                "upstash-callback-forward-upstash-workflow-stepname": "call other workflow",
                "upstash-callback-forward-upstash-workflow-steptype": "Call",
                "upstash-callback-retries": "3",
                "upstash-callback-workflow-calltype": "fromCallback",
                "upstash-callback-workflow-init": "false",
                "upstash-callback-workflow-runid": "wfr_id",
                "upstash-callback-workflow-url": "https://requestcatcher.com/api/workflow-three",
                "upstash-failure-callback-retries": "3",
                "upstash-feature-set": "WF_NoDelete,InitialBody",
                "upstash-method": "POST",
                "upstash-retries": "0",
                "upstash-telemetry-framework": "nextjs",
                "upstash-telemetry-runtime": "node@v22.6.0",
                "upstash-telemetry-sdk": "@upstash/workflow@v0.2.7",
                "upstash-workflow-calltype": "toCallback",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr_id",
                "upstash-workflow-sdk-version": "1",
                "upstash-workflow-url": "https://requestcatcher.com/api/workflow-three",
              },
            },
          ],
        },
      });
    });
  });

  describe("getNewUrlFromWorkflowId", () => {
    test("should return new url", () => {
      const url = "https://requestcatcher.com/api/original_workflow";
      const workflowId = "workflowId";
      const newUrl = getNewUrlFromWorkflowId(url, workflowId);

      expect(newUrl).toBe("https://requestcatcher.com/api/workflowId");
    });

    test("should ignore query parameters", () => {
      const url = "https://requestcatcher.com/api/original_workflow?query=param";
      const workflowId = "workflowId";
      const newUrl = getNewUrlFromWorkflowId(url, workflowId);

      expect(newUrl).toBe("https://requestcatcher.com/api/workflowId");
    });

    test("shuold ignore hash parameters", () => {
      const url = "https://requestcatcher.com/api/original_workflow#hash";
      const workflowId = "workflowId";
      const newUrl = getNewUrlFromWorkflowId(url, workflowId);

      expect(newUrl).toBe("https://requestcatcher.com/api/workflowId");
    });
  });
});
