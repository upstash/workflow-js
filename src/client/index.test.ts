import { describe, test } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { nanoid } from "../utils";

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
    const notifyData = { data: `notify-data-${nanoid()}` };
    await mockQStashServer({
      execute: async () => {
        await client.notify({ eventId, notifyBody: JSON.stringify(notifyData) });
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/notify/${eventId}`,
        token,
        body: notifyData,
      },
    });
  });
});
