import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { getSteps, makeCancelRequest, toPathSegment } from "./utils";
import { getWorkflowRunId } from "../utils";
import { triggerWorkflowDelete } from "../workflow-requests";
import { WorkflowContext } from "../context";
import { Client as QStashClient } from "@upstash/qstash";

describe("ids in request paths", () => {
  const token = "test-token";
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  const contextWithRunId = (workflowRunId: string) =>
    new WorkflowContext({
      qstashClient: new QStashClient({ baseUrl: MOCK_QSTASH_SERVER_URL, token, retry: false }),
      workflowRunId,
      initialPayload: undefined,
      headers: new Headers({}) as Headers,
      steps: [],
      url: "https://example.com/api/workflow",
    });

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

  test("toPathSegment rejects empty and dot ids", () => {
    expect(() => toPathSegment("", "Event id")).toThrow("Event id cannot be empty");
    for (const id of [".", "..", "%2e", "%2E%2e", ".%2e"]) {
      expect(() => toPathSegment(id, "Event id")).toThrow('Event id cannot be "." or ".."');
    }
  });

  test("an id that is not a string is checked and sent in its string form", async () => {
    expect(toPathSegment({ toString: () => "order:1" } as unknown as string)).toBe("order:1");
    expect(() =>
      toPathSegment({ toString: () => "../keys" } as unknown as string, "Event id")
    ).toThrow("Event id cannot contain");
    expect(toPathSegment(123 as unknown as string)).toBe("123");
    expect(toPathSegment(0 as unknown as string)).toBe("0");
    expect(toPathSegment(BigInt(7) as unknown as string)).toBe("7");
    expect(toPathSegment(false as unknown as string)).toBe("false");
    expect(() => toPathSegment(null as unknown as string, "Event id")).toThrow(
      "Event id cannot be empty"
    );
    await mockQStashServer({
      execute: async () => {
        await client.getWaiters({ eventId: 123 as unknown as string });
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: {
        method: "GET",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/waiters/123`,
        token,
      },
    });
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
        await expect(client.dlq.retryFailureFunction({ dlqId: "../../keys" })).rejects.toThrow(
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

  test("the cancel flag is sent as a query parameter", async () => {
    await mockQStashServer({
      execute: async () => {
        await triggerWorkflowDelete(contextWithRunId("wfr_order:123"), "result");
      },
      responseFields: { status: 200, body: "deleted" },
      receivesRequest: {
        method: "DELETE",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/wfr_order:123?cancel=false`,
        token,
        body: "result",
      },
    });
  });

  test("does not send a request for a run whose id is not a single segment", async () => {
    const requester = new QStashClient({ baseUrl: MOCK_QSTASH_SERVER_URL, token, retry: false })
      .http;
    await mockQStashServer({
      execute: async () => {
        await expect(makeCancelRequest(requester, "../../messages")).rejects.toThrow(
          "Workflow run id cannot contain"
        );
        await expect(getSteps(requester, "../../keys#")).rejects.toThrow(
          "Workflow run id cannot contain"
        );
        await expect(
          triggerWorkflowDelete(contextWithRunId("../../messages"), "result")
        ).rejects.toThrow("Workflow run id cannot contain");
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: false,
    });
  });
});
