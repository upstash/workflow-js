import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { Client } from ".";
import { getWorkflowRunId, nanoid } from "../utils";

describe("workflow client", () => {
  const token = nanoid();
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  describe("cancel - mocked", () => {
    test("should cancel single workflow run id", async () => {
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowRunIds: [workflowRunId] },
        },
      });
    });

    test("should cancel multiple workflow run ids", async () => {
      const workflowRunId = [`wfr-${nanoid()}`, `wfr-${nanoid()}`];
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowRunIds: workflowRunId },
        },
      });
    });

    test("should cancel workflowUrl", async () => {
      const workflowUrl = "http://workflow-endpoint.com";
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ workflowUrl });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowUrl },
        },
      });
    });

    test("should cancel all", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ all: true });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: {},
        },
      });
    });

    test("should throw if no option", async () => {
      const throws = () => client.cancel({});
      expect(throws).toThrow("The `cancel` method cannot be called without any options.");
    });
  });

  describe("cancel - live", () => {
    const liveClient = new Client({
      baseUrl: process.env.QSTASH_URL,
      token: process.env.QSTASH_TOKEN!,
    });

    test("should cancel single workflow run id", async () => {
      const { workflowRunId } = await liveClient.trigger({
        url: "http://requestcatcher.com",
      });

      const cancel = await liveClient.cancel({
        workflowRunId,
      });
      expect(cancel).toEqual({ cancelled: 1 });

      const throws = () => liveClient.cancel({ workflowRunId });
      expect(throws).toThrow(`{"error":"workflowRun ${workflowRunId} not found"}`);
    });

    test("should cancel multiple workflow run ids", async () => {
      const { workflowRunId: workflowRunIdOne } = await liveClient.trigger({
        url: "http://requestcatcher.com",
      });
      const { workflowRunId: workflowRunIdTwo } = await liveClient.trigger({
        url: "http://requestcatcher.com",
      });

      const throws = async () =>
        await liveClient.cancel({
          workflowRunId: [workflowRunIdOne, workflowRunIdTwo, "non-existent"],
        });

      // if there is any workflow which doesn't exist, we throw
      expect(throws).toThrow(`{"error":"workflowRun non-existent not found"}`);

      // trying to cancel the workflows one by one gives error, as they were canceled above
      const throwsFirst = async () => await liveClient.cancel({ workflowRunId: workflowRunIdOne });
      expect(throwsFirst).toThrow(`{"error":"workflowRun ${workflowRunIdOne} not found"}`);

      // trying to cancel the workflows one by one gives error, as they were canceled above
      const throwsSecond = async () => await liveClient.cancel({ workflowRunId: workflowRunIdTwo });
      expect(throwsSecond).toThrow(`{"error":"workflowRun ${workflowRunIdTwo} not found"}`);
    });

    test("should cancel workflowUrl", async () => {
      await liveClient.trigger({
        url: "http://requestcatcher.com/first",
      });
      await liveClient.trigger({
        url: "http://requestcatcher.com/second",
      });

      const cancel = await liveClient.cancel({
        workflowUrl: "http://requestcatcher.com",
      });

      expect(cancel).toEqual({ cancelled: 2 });
    });

    test.skip("should cancel all", async () => {
      // intentionally didn't write a test for cancel.all,
      // because it may break apps running on the same QStash user.
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
          "upstash-workflow-runid": `wfr_${myWorkflowRunId}`,
          "upstash-workflow-url": "https://www.my-website.com/api",
        },
      },
    });
  });
});
