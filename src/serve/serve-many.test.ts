import { describe, expect, test } from "bun:test";
import { createWorkflow, serveMany } from "../../platforms/nextjs";
import { Telemetry } from "../types";
import { createInvokeCallback } from "./serve-many";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { getRequest, MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { nanoid } from "../utils";
import { WORKFLOW_INVOKE_COUNT_HEADER } from "../constants";

describe("serveMany", () => {

  describe("serveMany", () => {
    test("should throw if workflowId contains '/'", () => {
      const throws = () => serveMany({
        "workflow/one": createWorkflow(async () => { }),
      })
      expect(throws).toThrow("Invalid workflow name found: 'workflow/one'. Workflow name cannot contain '/'.")
    })

    test("should throw if workflowId doesn't match", () => {
      const { POST: handler } = serveMany({
        "workflow-one": createWorkflow(async () => { }),
      })

      const request = new Request("http://localhost:3001/workflow-two", { method: "POST" })
      const throws = async () => await handler(request)

      expect(throws).toThrow("No workflows in serveMany found for 'workflow-two'")
    })
  })

  describe("createInvokeCallback", () => {
    test("should call create invoke", async () => {
      const token = nanoid();

      const telemetry: Telemetry = {
        sdk: "sdk",
        framework: "framework",
        runtime: "runtime",
      }
      const callback = createInvokeCallback(telemetry)
      const workflowId = "some-workflow-id"

      await mockQStashServer({
        execute: async () => {

          await callback({
            body: "some-body",
            workflow: {
              workflowId,
              callback
            },
            headers: { "custom": "custom-header-value" },
            retries: 6,
            workflowRunId: "some-run-id",
          }, {
            stepId: 4,
            concurrent: 1,
            stepName: "invoke-step",
            stepType: "Invoke",
          }, new WorkflowContext({
            headers: new Headers({ "original": "original-headers-value" }) as Headers,
            initialPayload: "initial-payload",
            qstashClient: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
            steps: [],
            url: `${WORKFLOW_ENDPOINT}/original_workflow`,
            workflowRunId: "wfr_original_workflow",
          }), 0)

        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/${workflowId}`,
          token,
          body: {
            body: "\"some-body\"",
            headers: {
              "Upstash-Workflow-Init": ["false"],
              "Upstash-Workflow-RunId": ["wfr_original_workflow"],
              "Upstash-Workflow-Url": ["https://requestcatcher.com/api/original_workflow"],
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
            workflowRunId: "some-run-id",
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
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "1"
          },
        },
      })
    })
  })

  describe("serve tests", () => {
    const token = nanoid();
    const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token })

    const workflowOne = createWorkflow(async (context: WorkflowContext<number>) => {
      const a = context.requestPayload + 2
      return `result ${a}`
    }, {
      qstashClient,
      receiver: undefined
    })

    const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
      await context.invoke(
        "invoke step two",
        {
          workflow: workflowOne,
          body: 2,
        }
      )
    }, {
      qstashClient,
      receiver: undefined
    })

    const { POST: handler } = serveMany({
      "workflow-one": workflowOne,
      "workflow-two": workflowTwo,
    })

    test("first invoke", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflow-two`,
        "wfr_id",
        "initial-payload",
        []
      )

      await mockQStashServer({
        execute: async () => {
          await handler(request)
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflow-one`,
          token,
          body: {
            body: "2",
            headers: {
              "Upstash-Failure-Callback-Retries": [
                "3"
              ],
              "Upstash-Feature-Set": [
                "LazyFetch,InitialBody"
              ],
              "Upstash-Forward-Upstash-Workflow-Sdk-Version": [
                "1"
              ],
              "Upstash-Retries": [
                "3"
              ],
              "Upstash-Telemetry-Framework": [
                "nextjs"
              ],
              "Upstash-Telemetry-Runtime": [
                "node@v22.6.0"
              ],
              "Upstash-Telemetry-Sdk": [
                "@upstash/workflow@v0.2.7"
              ],
              "Upstash-Workflow-Init": [
                "false"
              ],
              "Upstash-Workflow-RunId": [
                "wfr_id"
              ],
              "Upstash-Workflow-Runid": [
                "wfr_id"
              ],
              "Upstash-Workflow-Sdk-Version": [
                "1"
              ],
              "Upstash-Workflow-Url": [
                "https://requestcatcher.com/api/workflow-two"
              ],
              "content-type": [
                "application/json"
              ],
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
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "1"
          },
        },
      })
    })

    test("should increment invoke count in second invoke", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflow-two`,
        "wfr_id",
        "initial-payload",
        []
      )
      request.headers.set(WORKFLOW_INVOKE_COUNT_HEADER, "1")

      await mockQStashServer({
        execute: async () => {
          await handler(request)
        },
        responseFields: { body: "msgId", status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflow-one`,
          token,
          body: {
            body: "2",
            headers: {
              "Upstash-Failure-Callback-Retries": [
                "3"
              ],
              "Upstash-Feature-Set": [
                "LazyFetch,InitialBody"
              ],
              "Upstash-Forward-Upstash-Workflow-Sdk-Version": [
                "1"
              ],
              "Upstash-Retries": [
                "3"
              ],
              "Upstash-Telemetry-Framework": [
                "nextjs"
              ],
              "Upstash-Telemetry-Runtime": [
                "node@v22.6.0"
              ],
              "Upstash-Telemetry-Sdk": [
                "@upstash/workflow@v0.2.7"
              ],
              "Upstash-Workflow-Init": [
                "false"
              ],
              "Upstash-Workflow-RunId": [
                "wfr_id"
              ],
              "Upstash-Workflow-Runid": [
                "wfr_id"
              ],
              "Upstash-Workflow-Sdk-Version": [
                "1"
              ],
              "Upstash-Workflow-Url": [
                "https://requestcatcher.com/api/workflow-two"
              ],
              "content-type": [
                "application/json"
              ],
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
            [`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`]: "2"
          },
        },
      })
    })
  })
})
