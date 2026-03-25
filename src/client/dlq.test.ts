import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, eventually } from "../test-utils";
import { Client } from ".";
import { nanoid } from "../utils";

const WORKFLOW_LABEL = "some-label";
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
    label: WORKFLOW_LABEL,
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
          const result = await client.dlq.list({
            cursor,
            count,
            filter: { label: WORKFLOW_LABEL },
          });
          expect(result.messages).toEqual([MOCK_DLQ_MESSAGES[0]]);
          expect(result.messages[0].label).toBe(WORKFLOW_LABEL);
          expect(result.cursor).toBe(nextCursor);
        },
        responseFields: {
          status: 200,
          body: { messages: [MOCK_DLQ_MESSAGES[0]], cursor: nextCursor },
        },
        receivesRequest: {
          method: "GET",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?cursor=${cursor}&count=${count}&label=${WORKFLOW_LABEL}&source=workflow`,
          token,
        },
      });
    });

    test("should list DLQ messages with filter options", async () => {
      const filter = {
        fromDate: 1640995200000, // 2022-01-01
        toDate: 1672531200000, // 2023-01-01
        workflowUrl: "https://example.com",
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?fromDate=${filter.fromDate}&toDate=${filter.toDate}&workflowUrl=${encodeURIComponent(filter.workflowUrl)}&source=workflow`,
          token,
        },
      });
    });

    test("should list DLQ messages with fromDate and toDate as Date objects", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01
      const toDateMs = 1672531200000; // 2023-01-01
      const filter = {
        fromDate: new Date(fromDateMs),
        toDate: new Date(toDateMs),
        workflowUrl: "https://example.com",
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?fromDate=${fromDateMs}&toDate=${toDateMs}&workflowUrl=${encodeURIComponent(filter.workflowUrl)}&source=workflow`,
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
        workflowUrl: "https://example.com",
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
          url: `${MOCK_QSTASH_SERVER_URL}/v2/dlq?cursor=${cursor}&count=${count}&fromDate=${filter.fromDate}&workflowUrl=${encodeURIComponent(filter.workflowUrl)}&source=workflow`,
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
          const result = await client.dlq.resume(dlqId);
          expect(result).toEqual({
            cursor: undefined,
            workflowRuns: [{ workflowRunId, workflowCreatedAt }],
          });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
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
          const result = await client.dlq.resume(dlqIds);
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}`,
          token,
        },
      });
    });

    test("should return empty array when dlqIds is an empty array", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume([]);
          expect(result).toEqual({ workflowRuns: [] });
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should throw when dlqIds is empty in filter format", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.dlq.resume({ dlqIds: [] })).rejects.toThrow(
            "Empty dlqIds array provided"
          );
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should resume DLQ messages with filters", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ filter: { label: "my-label" } });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?label=my-label&count=100`,
          token,
        },
      });
    });

    test("should resume DLQ messages with multiple filters", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({
            filter: { label: "my-label", workflowUrl: "https://example.com/workflow" },
          });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?label=my-label&workflowUrl=${encodeURIComponent("https://example.com/workflow")}&count=100`,
          token,
        },
      });
    });

    test("should resume all DLQ messages", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ all: true });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?count=100`,
          token,
        },
      });
    });

    test("should resume with flowControl and retries options", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume(dlqId, {
            flowControl: { key: "my-key", rate: 10, parallelism: 3, period: "1m" },
            retries: 5,
          });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
          headers: {
            "upstash-flow-control-key": "my-key",
            "upstash-flow-control-value": "parallelism=3, rate=10, period=1m",
            "upstash-retries": "5",
          },
        },
      });
    });

    test("should resume with filter and flowControl options", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ filter: { label: "my-label" } }, { retries: 2 });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?label=my-label&count=100`,
          token,
          headers: {
            "upstash-retries": "2",
          },
        },
      });
    });

    test("should resume single DLQ message with legacy { dlqId } format", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId });
          expect(result).toEqual({ workflowRunId, workflowCreatedAt });
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/resume?dlqIds=${dlqId}`,
          token,
        },
      });
    });

    test("should resume multiple DLQ messages with legacy { dlqId } format", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.resume({ dlqId: dlqIds });
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
          const result = await client.dlq.restart(dlqId);
          expect(result).toEqual({
            cursor: undefined,
            workflowRuns: [{ workflowRunId, workflowCreatedAt }],
          });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
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
          const result = await client.dlq.restart(dlqIds);
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}`,
          token,
        },
      });
    });

    test("should return empty array when dlqIds is an empty array", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart([]);
          expect(result).toEqual({ workflowRuns: [] });
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should throw when dlqIds is empty in filter format", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.dlq.restart({ dlqIds: [] })).rejects.toThrow(
            "Empty dlqIds array provided"
          );
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should restart DLQ messages with filters", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ filter: { label: "my-label" } });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?label=my-label&count=100`,
          token,
        },
      });
    });

    test("should restart DLQ messages with multiple filters", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({
            filter: { label: "my-label", workflowUrl: "https://example.com/workflow" },
          });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?label=my-label&workflowUrl=${encodeURIComponent("https://example.com/workflow")}&count=100`,
          token,
        },
      });
    });

    test("should restart all DLQ messages", async () => {
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ all: true });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?count=100`,
          token,
        },
      });
    });

    test("should restart with flowControl and retries options", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart(dlqId, {
            flowControl: { key: "my-key", rate: 10, parallelism: 3, period: "1m" },
            retries: 5,
          });
          expect(result).toEqual({ cursor: undefined, workflowRuns: responses });
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: responses },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
          headers: {
            "upstash-flow-control-key": "my-key",
            "upstash-flow-control-value": "parallelism=3, rate=10, period=1m",
            "upstash-retries": "5",
          },
        },
      });
    });

    test("should restart single DLQ message with legacy { dlqId } format", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId });
          expect(result).toEqual({ workflowRunId, workflowCreatedAt });
        },
        responseFields: {
          status: 200,
          body: { workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/restart?dlqIds=${dlqId}`,
          token,
        },
      });
    });

    test("should restart multiple DLQ messages with legacy { dlqId } format", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const responses = [
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T00:00:00Z" },
        { workflowRunId: `wfr-${nanoid()}`, workflowCreatedAt: "2023-01-01T01:00:00Z" },
      ];

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.restart({ dlqId: dlqIds });
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
        },
      });
    });
  });

  describe("retryFailureFunction", () => {
    test("should retry failure function of a DLQ message", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const workflowRunId = `wfr-${nanoid()}`;
      const workflowCreatedAt = "2023-01-01T00:00:00Z";

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.retryFailureFunction({ dlqId });
          expect(result.workflowRunId).toBe(workflowRunId);
          expect(result.workflowCreatedAt).toBe(workflowCreatedAt);
        },
        responseFields: {
          status: 200,
          body: { cursor: "", workflowRuns: [{ workflowRunId, workflowCreatedAt }] },
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq/callback/${dlqId}`,
          token,
        },
      });
    });
  });

  describe("delete", () => {
    test("should delete a single DLQ message", async () => {
      const dlqId = `dlq-${nanoid()}`;
      const deleted = 1;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete(dlqId);
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?dlqIds=${dlqId}`,
          token,
        },
      });
    });

    test("should delete multiple DLQ messages", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const deleted = 3;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete(dlqIds);
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}&dlqIds=${dlqIds[2]}`,
          token,
        },
      });
    });

    test("should handle empty array of DLQ IDs", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete([]);
          expect(result.deleted).toBe(0);
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should throw when dlqIds is empty in filter format", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.dlq.delete({ dlqIds: [] })).rejects.toThrow(
            "Empty dlqIds array provided"
          );
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should delete DLQ messages with dlqIds filter", async () => {
      const dlqIds = [`dlq-${nanoid()}`, `dlq-${nanoid()}`];
      const deleted = 2;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({ dlqIds });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?dlqIds=${dlqIds[0]}&dlqIds=${dlqIds[1]}`,
          token,
        },
      });
    });

    test("should delete DLQ messages with label filter", async () => {
      const deleted = 4;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({ filter: { label: "my-label" } });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?label=my-label&count=100`,
          token,
        },
      });
    });

    test("should delete DLQ messages with workflowUrl filter", async () => {
      const deleted = 2;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({
            filter: { workflowUrl: "https://example.com/workflow" },
          });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?workflowUrl=${encodeURIComponent("https://example.com/workflow")}&count=100`,
          token,
        },
      });
    });

    test("should delete DLQ messages with fromDate and toDate filters", async () => {
      const deleted = 3;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({
            filter: { fromDate: 1640995200000, toDate: 1672531200000 },
          });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?fromDate=1640995200000&toDate=1672531200000&count=100`,
          token,
        },
      });
    });

    test("should delete DLQ messages with fromDate and toDate as Date objects", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01
      const toDateMs = 1672531200000; // 2023-01-01
      const deleted = 3;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({
            filter: { fromDate: new Date(fromDateMs), toDate: new Date(toDateMs) },
          });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?fromDate=${fromDateMs}&toDate=${toDateMs}&count=100`,
          token,
        },
      });
    });

    test("should delete DLQ messages with mixed Date and number filters", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01
      const deleted = 1;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({
            filter: {
              label: "my-label",
              workflowUrl: "https://example.com/workflow",
              fromDate: new Date(fromDateMs),
            },
          });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?label=my-label&workflowUrl=${encodeURIComponent("https://example.com/workflow")}&fromDate=${fromDateMs}&count=100`,
          token,
        },
      });
    });

    test("should delete DLQ messages with multiple filters", async () => {
      const deleted = 1;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({
            filter: {
              label: "my-label",
              workflowUrl: "https://example.com/workflow",
              fromDate: 1640995200000,
            },
          });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?label=my-label&workflowUrl=${encodeURIComponent("https://example.com/workflow")}&fromDate=1640995200000&count=100`,
          token,
        },
      });
    });

    test("should delete all DLQ messages with all:true filter", async () => {
      const deleted = 10;

      await mockQStashServer({
        execute: async () => {
          const result = await client.dlq.delete({ all: true });
          expect(result.deleted).toBe(deleted);
        },
        responseFields: {
          status: 200,
          body: { deleted },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/dlq?count=100`,
          token,
        },
      });
    });
  });

  /**
   * tests skipped to avoid breaking live apps
   */
  describe.skip("DLQ - live", () => {
    const liveClient = new Client({
      baseUrl: process.env.QSTASH_URL,
      token: process.env.QSTASH_TOKEN!,
    });

    test(
      "should resume all DLQ messages",
      async () => {
        // trigger workflows that will fail and end up in DLQ
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });

        // wait for messages to land in DLQ
        await eventually(
          async () => {
            const { messages } = await liveClient.dlq.list();
            expect(messages.length).toBeGreaterThanOrEqual(2);
          },
          { timeout: 30000, interval: 2000 }
        );

        const result = await liveClient.dlq.resume({ all: true });
        expect(result.workflowRuns.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 60000 }
    );

    test(
      "should restart all DLQ messages",
      async () => {
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });

        await eventually(
          async () => {
            const { messages } = await liveClient.dlq.list();
            expect(messages.length).toBeGreaterThanOrEqual(2);
          },
          { timeout: 30000, interval: 2000 }
        );

        const result = await liveClient.dlq.restart({ all: true });
        expect(result.workflowRuns.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 60000 }
    );

    test(
      "should delete all DLQ messages",
      async () => {
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });
        await liveClient.trigger({ url: "https://mock.httpstatus.io/500", retries: 0 });

        await eventually(
          async () => {
            const { messages } = await liveClient.dlq.list();
            expect(messages.length).toBeGreaterThanOrEqual(2);
          },
          { timeout: 30000, interval: 2000 }
        );

        const result = await liveClient.dlq.delete({ all: true });
        expect(result.deleted).toBeGreaterThanOrEqual(2);
      },
      { timeout: 60000 }
    );
  });
});
