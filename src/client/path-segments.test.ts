import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { toPathSegment } from "./utils";

describe("ids in request paths", () => {
  const token = "test-token";
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  test("toPathSegment keeps plain ids unchanged", () => {
    expect(toPathSegment("wfr_abc-123.x~y")).toBe("wfr_abc-123.x~y");
  });

  test("toPathSegment encodes separators", () => {
    expect(toPathSegment("a/b")).toBe("a%2Fb");
    expect(toPathSegment("../keys")).toBe("..%2Fkeys");
    expect(toPathSegment("id?x=1#y")).toBe("id%3Fx%3D1%23y");
    expect(toPathSegment("%2e%2e")).toBe("%252e%252e");
  });

  test("toPathSegment rejects empty and dot ids", () => {
    expect(() => toPathSegment("", "Event id")).toThrow("Event id cannot be empty");
    expect(() => toPathSegment(".", "Event id")).toThrow('Event id cannot be "." or ".."');
    expect(() => toPathSegment("..", "Event id")).toThrow('Event id cannot be "." or ".."');
  });

  test("getWaiters keeps the event id in its own segment", async () => {
    await mockQStashServer({
      execute: async () => {
        await client.getWaiters({ eventId: "../keys" });
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: {
        method: "GET",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/waiters/..%2Fkeys`,
        token,
      },
    });
  });

  test("notify keeps the event id in its own segment", async () => {
    await mockQStashServer({
      execute: async () => {
        await client.notify({ eventId: "a/../../batch", eventData: "data" });
      },
      responseFields: { status: 200, body: [] },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/notify/a%2F..%2F..%2Fbatch`,
        token,
        body: "data",
      },
    });
  });

  test("dlq callback keeps the dlq id in its own segment", async () => {
    await mockQStashServer({
      execute: async () => {
        await client.dlq.cancelFailureFunction({ dlqId: "../../keys" });
      },
      responseFields: { status: 200, body: {} },
      receivesRequest: {
        method: "DELETE",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/callback/..%2F..%2Fkeys`,
        token,
      },
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
});
