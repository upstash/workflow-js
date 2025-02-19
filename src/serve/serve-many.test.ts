import { describe, expect, test } from "bun:test";
import { createWorkflow, serveMany } from "../../platforms/nextjs";
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

  describe("serve tests", () => {
    const token = nanoid();
    const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token })

    const workflowOne = createWorkflow(async (context: WorkflowContext<number>) => {
      const a = context.requestPayload + 2
      return `result ${a}`
    })

    const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
      await context.invoke(
        "invoke step two",
        {
          workflow: workflowOne,
          body: 2,
        }
      )
    })

    const { POST: handler } = serveMany({
      "workflow-one": workflowOne,
      "workflow-two": workflowTwo,
    }, {
      qstashClient,
      receiver: undefined
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
