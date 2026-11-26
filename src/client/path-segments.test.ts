import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { toPathSegment } from "./utils";
import { getWorkflowRunId } from "../utils";
import { validateRequest } from "../workflow-parser";
import { triggerWorkflowDelete } from "../workflow-requests";
import { WorkflowContext } from "../context";
import { Client as QStashClient } from "@upstash/qstash";
import {
  WORKFLOW_FAILURE_CALLBACK_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_UNKOWN_SDK_VERSION_HEADER,
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
      ". .",
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
      ".\t.",
      ".. ",
      " ..",
      "..\n",
    ]) {
      expect(() => toPathSegment(id, "Event id")).toThrow("Event id cannot contain");
    }
  });

  test("toPathSegment rejects empty, non-string and dot ids", () => {
    expect(() => toPathSegment("", "Event id")).toThrow("Event id cannot be empty");
    expect(() => toPathSegment(["a"] as unknown as string, "Event id")).toThrow(
      "Event id must be a string"
    );
    for (const id of [".", "..", "%2e", "%2E%2e", ".%2e"]) {
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
    expect(() => getWorkflowRunId("a ")).toThrow("Workflow run id cannot contain");
  });

  test("a custom run id is checked together with its prefix", () => {
    expect(getWorkflowRunId("")).toBe("wfr_");
    expect(getWorkflowRunId(" a")).toBe("wfr_ a");
    expect(getWorkflowRunId("..")).toBe("wfr_..");
    expect(getWorkflowRunId(123 as unknown as string)).toBe("wfr_123");
    expect(getWorkflowRunId(null as unknown as string)).toMatch(/^wfr_[\w-]{21}$/);
  });

  const requestWithRunId = (runId: string, headers: Record<string, string>) =>
    new Request("https://example.com/api/workflow", {
      method: "POST",
      headers: { ...headers, [WORKFLOW_ID_HEADER]: runId },
    });

  test("the first request of a run with an id that is not a single segment is not processed", () => {
    for (const runId of ["..", "../../messages", "wfr_x?a=b", String.raw`wfr_x\y`]) {
      const request = requestWithRunId(runId, { [WORKFLOW_UNKOWN_SDK_VERSION_HEADER]: "true" });
      expect(() => validateRequest(request)).toThrow("Workflow run id cannot");
    }
  });

  test("later requests and failure callbacks of a run are processed with its id", () => {
    for (const runId of ["wfr_order/123", "wfr_x?a=b", "wfr_x#y"]) {
      for (const [header, value] of [
        [WORKFLOW_PROTOCOL_VERSION_HEADER, WORKFLOW_PROTOCOL_VERSION],
        [WORKFLOW_FAILURE_CALLBACK_HEADER, "true"],
      ]) {
        const request = requestWithRunId(runId, { [header]: value });
        expect(validateRequest(request).workflowRunId).toBe(runId);
      }
    }
  });

  test("does not send a request for a run whose id is not a single segment", async () => {
    const context = new WorkflowContext({
      qstashClient: new QStashClient({ baseUrl: MOCK_QSTASH_SERVER_URL, token, retry: false }),
      workflowRunId: "../../messages",
      initialPayload: undefined,
      headers: new Headers({}) as Headers,
      steps: [],
      url: "https://example.com/api/workflow",
      workflowRunCreatedAt: 0,
    });
    await mockQStashServer({
      execute: async () => {
        await expect(triggerWorkflowDelete(context, "result")).rejects.toThrow(
          "Workflow run id cannot contain"
        );
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: false,
    });
  });
});
