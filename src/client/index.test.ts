import { describe, test } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { Client } from ".";
import { getWorkflowRunId, nanoid } from "../utils";

describe("workflow client", () => {
  const token = nanoid();
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  test("should send cancel", async () => {
    const workflowRunId = `wfr-${nanoid()}`;
    await mockQStashServer({
      execute: async () => {
        await client.cancel({ workflowRunId });
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "DELETE",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=true`,
        token,
      },
    });
  });

  test("should send notify", async () => {
    const eventId = `event-id-${nanoid()}`;
    const eventData = { data: `notify-data-${nanoid()}` };
    await mockQStashServer({
      execute: async () => {
        await client.notify({ eventId, eventData });
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/notify/${eventId}`,
        token,
        body: eventData,
      },
    });
  });

  test("should trigger workflow run", async () => {
    const myWorkflowRunId = `mock-${getWorkflowRunId()}`;
    const body = "request-body";
    await mockQStashServer({
      execute: async () => {
        await client.trigger({
          url: WORKFLOW_ENDPOINT,
          body,
          headers: { "user-header": "user-header-value" },
          workflowRunId: myWorkflowRunId,
          retries: 15,
        });
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
        token,
        body,
        headers: {
          "upstash-forward-upstash-workflow-sdk-version": "1",
          "upstash-forward-user-header": "user-header-value",
          "upstash-method": "POST",
          "upstash-retries": "15",
          "upstash-workflow-init": "true",
          "upstash-workflow-runid": myWorkflowRunId,
          "upstash-workflow-url": "https://www.my-website.com/api",
        },
      },
    });
  });
});
