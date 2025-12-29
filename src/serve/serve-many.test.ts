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
import { getNewUrlFromWorkflowId } from "./serve-many";

describe("serveMany", () => {
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
    const qstashClient = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token,
      enableTelemetry: false,
    });

    // 1. Workflow: (context: WorkflowContext<{ count: number }>)
    //    - Purpose: Base workflow, does nothing, used for invocation/call by others.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const workflowOne = createWorkflow(async (context: WorkflowContext<{ count: number }>) => {
      // This workflow is a base workflow for testing. It does nothing.
      // Used to test invocation/call from other workflows.
      return;
    });

    // 2. Workflow: (context: WorkflowContext<string>)
    //    - Purpose: Invokes workflowOne
    const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
      await context.invoke("invoke workflow one", {
        workflow: workflowOne,
        body: { count: 42 },
      });
    });

    // 3. Workflow: (context)
    //    - Purpose: Calls workflowOne
    const workflowThree = createWorkflow(async (context: WorkflowContext) => {
      await context.call("call workflow one", {
        workflow: workflowOne,
        body: { count: 99 },
      });
    });

    // 4. Workflow: (context: WorkflowContext<undefined>)
    //    - Purpose: Calls workflowTwo, checks that string is not stringified.
    const workflowFour = createWorkflow(async (context: WorkflowContext<undefined>) => {
      await context.call("call workflow two", {
        workflow: workflowTwo,
        body: "hello world",
      });
    });

    // 5. Workflow: (context)
    //    - Purpose: Invokes workflowTwo, checks that string is not stringified.
    const workflowFive = createWorkflow(async (context) => {
      await context.invoke("invoke workflow two", {
        workflow: workflowTwo,
        body: "hello world",
      });
    });

    // 6. Workflow: (context)
    //    - Purpose: Invokes workflowThree, passes body undefined
    const workflowSix = createWorkflow(async (context) => {
      await context.invoke("invoke workflow three", {
        workflow: workflowThree,
        body: undefined,
      });
    });

    // 7. Workflow: (context)
    //    - Purpose: Calls workflowFour, passes no body
    const workflowSeven = createWorkflow(async (context) => {
      await context.call("call workflow three", {
        workflow: workflowFour,
      });
    });

    const { POST: handler } = serveMany(
      {
        workflowOne,
        workflowTwo,
        workflowThree,
        workflowFour,
        workflowFive,
        workflowSix,
        workflowSeven,
      },
      {
        qstashClient,
        receiver: undefined,
      }
    );

    test("should invoke workflowOne from workflowTwo with object body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowTwo`,
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflowOne`,
          token,
          body: {
            body: '{"count":42}',
            headers: expect.any(Object),
            workflowRunId: expect.any(String),
            workflowUrl: "https://requestcatcher.com/api/workflowTwo",
            step: expect.any(Object),
          },
        },
      });
    });

    // Additional tests for new workflows:
    test("should call workflowOne from workflowThree with object body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowThree`,
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
              body: '{"count":99}',
              destination: "https://requestcatcher.com/api/workflowOne",
              headers: expect.any(Object),
            },
          ],
        },
      });
    });

    test("should call workflowTwo from workflowFour with string body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowFour`,
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              body: "hello world",
              destination: "https://requestcatcher.com/api/workflowTwo",
            }),
          ],
        },
      });
    });

    test("should invoke workflowTwo from workflowFive with string body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowFive`,
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflowTwo`,
          token,
          body: {
            body: "hello world",
            headers: expect.any(Object),
            workflowRunId: expect.any(String),
            workflowUrl: "https://requestcatcher.com/api/workflowFive",
            step: expect.any(Object),
          },
        },
      });
    });

    test("should invoke workflowThree from workflowSix with no body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowSix`,
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}/workflowThree`,
          token,
          body: {
            headers: expect.any(Object),
            workflowRunId: expect.any(String),
            workflowUrl: "https://requestcatcher.com/api/workflowSix",
            step: expect.any(Object),
          },
        },
      });
    });

    test("should call workflowFour from workflowSeven with no body", async () => {
      const request = getRequest(
        `${WORKFLOW_ENDPOINT}/workflowSeven`,
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              destination: "https://requestcatcher.com/api/workflowFour",
            }),
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
