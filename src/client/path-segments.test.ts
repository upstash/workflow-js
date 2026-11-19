import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { toPathSegment } from "./utils";
import { getWorkflowRunId } from "../utils";
import { validateRequest } from "../workflow-parser";
import {
  WORKFLOW_ID_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "../constants";

describe("ids in request paths", () => {
  const token = "test-token";
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  test("toPathSegment keeps ordinary ids unchanged", () => {
    for (const id of [
      "wfr_abc-123.x~y",
      "user:1@example.com+a=b",
      "order:123",
      "a,b;c&d$e",
      "100%",
      "a b",
    ]) {
      expect(toPathSegment(id)).toBe(id);
    }
  });

  test("toPathSegment rejects ids that do not stay in one segment", () => {
    for (const id of [
      "a/b",
      String.raw`a\b`,
      "a?b",
      "a#b",
      "a\tb",
      "a\nb",
      " a",
      "a ",
      "../keys",
    ]) {
      expect(() => toPathSegment(id, "Event id")).toThrow("Event id cannot contain");
    }
  });

  test("toPathSegment rejects empty, non-string and dot ids", () => {
    expect(() => toPathSegment("", "Event id")).toThrow("Event id cannot be empty");
    expect(() => toPathSegment(["a"] as unknown as string, "Event id")).toThrow(
      "Event id must be a string"
    );
    for (const id of [".", "..", "%2e", "%2E%2e", ".%2e", ".\t.", ".. ", " ..", "..\n"]) {
      expect(() => toPathSegment(id, "Event id")).toThrow('Event id cannot be "." or ".."');
    }
  });

  test("an id with other characters is sent as it is", async () => {
    await mockQStashServer({
      execute: async () => {
        await client.getWaiters({ eventId: "order:123@a+b" });
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: {
        method: "GET",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/waiters/order:123@a+b`,
        token,
      },
    });
  });

  test("does not send a request for an id with a path separator", async () => {
    await mockQStashServer({
      execute: async () => {
        await expect(client.getWaiters({ eventId: "../keys" })).rejects.toThrow(
          "Event id cannot contain"
        );
        await expect(
          client.notify({ eventId: "a/../../batch", eventData: "data" })
        ).rejects.toThrow("Event id cannot contain");
        await expect(client.dlq.cancelFailureFunction({ dlqId: "../../keys" })).rejects.toThrow(
          "DLQ id cannot contain"
        );
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: false,
    });
  });

  test("does not send a request for a dot id", async () => {
    await mockQStashServer({
      execute: async () => {
        await expect(client.getWaiters({ eventId: ".." })).rejects.toThrow(
          'Event id cannot be "." or ".."'
        );
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: false,
    });
  });

  test("a custom run id has to be a single segment", () => {
    expect(getWorkflowRunId("order:123")).toBe("wfr_order:123");
    expect(() => getWorkflowRunId("user/123")).toThrow("Workflow run id cannot contain");
    expect(() => getWorkflowRunId("..")).toThrow('Workflow run id cannot be "." or ".."');
  });

  test("a request with a run id that is not a single segment is not processed", () => {
    for (const runId of ["..", "../../messages", "wfr_x?a=b", String.raw`wfr_x\y`]) {
      const request = new Request("https://example.com/api/workflow", {
        method: "POST",
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          [WORKFLOW_ID_HEADER]: runId,
        },
      });
      expect(() => validateRequest(request)).toThrow("Workflow run id cannot");
    }
  });
});
