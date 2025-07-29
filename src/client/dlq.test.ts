import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer } from "../test-utils";
import { Client } from ".";
import { nanoid } from "../utils";

const MOCK_DLQ_MESSAGES = [
  {
    dlqId: `dlq-${nanoid()}`,
    header: { "user-agent": ["test-agent"] },
    body: "all-params-body-1",
    maxRetries: 1,
    notBefore: 1645000000000,
    createdAt: 1645000000000,
    callerIP: "192.168.0.100",
    workflowRunId: `wfr-${nanoid()}`,
    workflowCreatedAt: 1645000000000,
    workflowUrl: "https://example.com/all-params-1",
    responseStatus: 422,
    responseHeader: { "content-length": ["100"] },
    responseBody: "Validation Error",
    failureCallbackInfo: {
      state: "CALLBACK_FAIL",
      responseStatus: 500,
      responseBody: "Internal Server Error",
      responseHeaders: { "content-type": ["application/json"] },
    },
    failureCallback: "https://example.com/failure-callback",
  },
  {
    dlqId: `dlq-${nanoid()}`,
    header: { accept: ["application/json"] },
    body: "all-params-body-2",
    maxRetries: 4,
    notBefore: 1645100000000,
    createdAt: 1645100000000,
    callerIP: "192.168.0.101",
    workflowRunId: `wfr-${nanoid()}`,
    workflowCreatedAt: 1645100000000,
    workflowUrl: "https://example.com/all-params-2",
    responseStatus: 503,
    responseHeader: { "retry-after": ["60"] },
    responseBody: "Service Unavailable",
    failureCallback: "https://example.com/failure-callback",
  },
] as Awaited<ReturnType<Client["dlq"]["list"]>>["messages"];

describe("DLQ", () => {
  const token = nanoid();
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  describe("list", () => {
    test("should list DLQ messages without parameters", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.list();
          expect(result.messages).toEqual([MOCK_DLQ_MESSAGES[0]]);
          expect(result.cursor).toBeUndefined();
        },
        responseFields: {
          status: 200,
          body: { messages: [MOCK_DLQ_MESSAGES[0]], cursor: undefined },
        },
        receivesRequest: {
          method: "GET",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?source=workflow`,
          token,
        },
      });
    });

    test("should list DLQ messages with cursor and count", async () => {
      const cursor = `cursor-${nanoid()}`;
      const count = 10;
      const nextCursor = `next-${cursor}`;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.list({ cursor, count });
          expect(result.messages).toEqual([MOCK_DLQ_MESSAGES[0]]);
          expect(result.cursor).toBe(nextCursor);
        },
        responseFields: {
          status: 200,
          body: { messages: [MOCK_DLQ_MESSAGES[0]], cursor: nextCursor },
        },
        receivesRequest: {
          method: "GET",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?cursor=${cursor}&count=${count}&source=workflow`,
          token,
        },
      });
    });

    test("should list DLQ messages with filter options", async () => {
      const filter = {
        fromDate: 1640995200000, // 2022-01-01
        toDate: 1672531200000, // 2023-01-01
        url: "https://example.com",
        responseStatus: 500,
      };

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.list({ filter });
          expect(result.messages).toEqual([MOCK_DLQ_MESSAGES[0]]);
          expect(result.cursor).toBeUndefined();
        },
        responseFields: {
          status: 200,
          body: { messages: [MOCK_DLQ_MESSAGES[0]], cursor: undefined },
        },
        receivesRequest: {
          method: "GET",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?fromDate=${filter.fromDate}&toDate=${filter.toDate}&url=${encodeURIComponent(filter.url)}&responseStatus=${filter.responseStatus}&source=workflow`,
          token,
        },
      });
    });

    test("should list DLQ messages with all parameters", async () => {
      const cursor = `cursor-${nanoid()}`;
      const count = 5;
      const nextCursor = `next-${cursor}`;
      const filter = {
        fromDate: 1640995200000,
        url: "https://example.com",
      };

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.list({ cursor, count, filter });
          expect(result.messages).toEqual(MOCK_DLQ_MESSAGES);
          expect(result.cursor).toBe(nextCursor);
        },
        responseFields: {
          status: 200,
          body: { messages: MOCK_DLQ_MESSAGES, cursor: nextCursor },
        },
        receivesRequest: {
          method: "GET",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?cursor=${cursor}&count=${count}&fromDate=${filter.fromDate}&url=${encodeURIComponent(filter.url)}&source=workflow`,
          token,
        },
      });
    });
  });

  describe("resume", () => {
    test("should resume single DLQ message", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
          headers: {},
        },
      });
    });

    test("should resume multiple DLQ messages", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId: dlqIds });
          expect(Array.isArray(result)).toBe(true);
          expect(result).toEqual(responses);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}`,
          token,
          headers: {},
        },
      });
    });

    test("should resume DLQ message with flow control", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const flowControl = { key: "test-key", rate: 10, parallelism: 5 };

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId, flowControl });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Flow-Control-Key": "test-key",
            "Upstash-Flow-Control-Value": "parallelism=5, rate=10",
          },
        },
      });
    });

    test("should resume DLQ message with retries", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const retries = 5;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId, retries });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Retries": "5",
          },
        },
      });
    });

    test("should resume DLQ message with all parameters", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const flowControl = { key: "test-key", rate: 10, parallelism: 5 };
      const retries = 3;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId, flowControl, retries });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Flow-Control-Key": "test-key",
            "Upstash-Flow-Control-Value": "parallelism=5, rate=10",
            "Upstash-Retries": "3",
          },
        },
      });
    });
  });

  describe("restart", () => {
    test("should restart single DLQ message", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
          headers: {},
        },
      });
    });

    test("should restart multiple DLQ messages", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId: dlqIds });
          expect(Array.isArray(result)).toBe(true);
          expect(result).toEqual(responses);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}`,
          token,
          headers: {},
        },
      });
    });

    test("should restart DLQ message with flow control", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const flowControl = { key: "test-key", rate: 10, parallelism: 5 };

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId, flowControl });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Flow-Control-Key": "test-key",
            "Upstash-Flow-Control-Value": "parallelism=5, rate=10",
          },
        },
      });
    });

    test("should restart DLQ message with retries", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const retries = 5;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId, retries });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Retries": "5",
          },
        },
      });
    });

    test("should restart DLQ message with all parameters", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";
      const flowControl = { key: "test-key", rate: 10, parallelism: 5 };
      const retries = 3;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId, flowControl, retries });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
          headers: {
            "Upstash-Flow-Control-Key": "test-key",
            "Upstash-Flow-Control-Value": "parallelism=5, rate=10",
            "Upstash-Retries": "3",
          },
        },
      });
    });
  });
});
