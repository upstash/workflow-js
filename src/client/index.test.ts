import { describe, test, expect } from "bun:test";
import {
  MOCK_DESTINATION_HOST,
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
  eventually,
} from "../test-utils";
import { Client } from ".";
import type { WorkflowRunCancelFilters } from "./filter-types";
import { Client as QStashClient } from "@upstash/qstash";
import { getWorkflowRunId, nanoid } from "../utils";
import { triggerFirstInvocation } from "../workflow-requests";
import { WorkflowContext } from "../context";
import { WorkflowNonRetryableError } from "../error";

describe("workflow client", () => {
  const token = nanoid();
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  describe("cancel - mocked", () => {
    test("should cancel single workflow run id", async () => {
      const id = `wfr-${nanoid()}`;
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel(id);
          expect(result).toEqual({ cancelled: 1 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowRunIds=${id}`,
          token,
        },
      });
    });

    test("should cancel multiple workflow run ids", async () => {
      const ids = [`wfr-${nanoid()}`, `wfr-${nanoid()}`];
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel(ids);
          expect(result).toEqual({ cancelled: 2 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowRunIds=${ids[0]}&workflowRunIds=${ids[1]}`,
          token,
        },
      });
    });

    test("should cancel single workflow run id passed as array", async () => {
      const ids = [`wfr-${nanoid()}`];
      await mockQStashServer({
        execute: async () => {
          await client.cancel(ids);
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowRunIds=${ids[0]}`,
          token,
        },
      });
    });

    test("should cancel with workflowUrl (exact match)", async () => {
      const workflowUrl = "http://workflow-endpoint.com";
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ filter: { workflowUrl } });
          expect(result).toEqual({ cancelled: 5 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 5 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowUrl=${encodeURIComponent(workflowUrl)}&workflowUrlExactMatch=true&count=100`,
          token,
        },
      });
    });

    test("should cancel with workflowUrlStartingWith (prefix match)", async () => {
      const workflowUrl = "https://workflow-endpoint.com/specific-path";
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({
            filter: { workflowUrlStartingWith: workflowUrl },
          });
          expect(result).toEqual({ cancelled: 3 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 3 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowUrl=${encodeURIComponent(workflowUrl)}&count=100`,
          token,
        },
      });
    });

    test("should cancel with workflowUrl and additional filters", async () => {
      const workflowUrl = "https://workflow-endpoint.com/specific-path";
      const label = "my-label";
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { workflowUrl, label } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?label=${label}&workflowUrl=${encodeURIComponent(workflowUrl)}&workflowUrlExactMatch=true&count=100`,
          token,
        },
      });
    });

    test("should cancel with multiple workflowUrls (exact match)", async () => {
      const url1 = "https://a.workflow-endpoint.com";
      const url2 = "https://b.workflow-endpoint.com";
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ filter: { workflowUrl: [url1, url2] } });
          expect(result).toEqual({ cancelled: 4 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 4 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowUrl=${encodeURIComponent(url1)}&workflowUrl=${encodeURIComponent(url2)}&workflowUrlExactMatch=true&count=100`,
          token,
        },
      });
    });

    test("should cancel with multiple workflowUrlStartingWith (prefix match)", async () => {
      const url1 = "https://a.workflow-endpoint.com/path";
      const url2 = "https://b.workflow-endpoint.com/path";
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({
            filter: { workflowUrlStartingWith: [url1, url2] },
          });
          expect(result).toEqual({ cancelled: 2 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowUrl=${encodeURIComponent(url1)}&workflowUrl=${encodeURIComponent(url2)}&count=100`,
          token,
        },
      });
    });

    test("should cancel with multi-value callerIp and flowControlKey filters", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({
            filter: {
              callerIp: ["1.2.3.4", "5.6.7.8"],
              flowControlKey: ["key-1", "key-2"],
            },
          });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 3 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?callerIp=1.2.3.4&callerIp=5.6.7.8&flowControlKey=key-1&flowControlKey=key-2&count=100`,
          token,
        },
      });
    });

    test("should cancel with multiple labels (OR semantics)", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { label: ["label-1", "label-2"] } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?label=label-1&label=label-2&count=100`,
          token,
        },
      });
    });

    test("should cancel with host and path filters", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { host: ["a.com", "b.com"], path: "/webhook" } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?host=a.com&host=b.com&path=%2Fwebhook&count=100`,
          token,
        },
      });
    });

    test("should cancel all", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ all: true });
          expect(result).toEqual({ cancelled: 10 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 10 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?count=100`,
          token,
        },
      });
    });

    test("should return early when called with empty array", async () => {
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel([]);
          expect(result).toEqual({ cancelled: 0 });
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should not send request when called with an empty string", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.cancel("")).rejects.toThrow("Workflow run id cannot be empty");
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should throw when a filter field is an empty array", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.cancel({ filter: { workflowUrl: [] } })).rejects.toThrow(
            "Empty array provided for filter field 'workflowUrl'"
          );
          await expect(client.cancel({ filter: { workflowUrlStartingWith: [] } })).rejects.toThrow(
            "Empty array provided for filter field 'workflowUrlStartingWith'"
          );
          await expect(client.cancel({ filter: { callerIp: [] } })).rejects.toThrow(
            "Empty array provided for filter field 'callerIp'"
          );
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should not send request when an array contains an empty string", async () => {
      await mockQStashServer({
        execute: async () => {
          await expect(client.cancel(["valid-id", ""])).rejects.toThrow(
            "Workflow run id cannot be empty"
          );
        },
        responseFields: { status: 200, body: {} },
        receivesRequest: false,
      });
    });

    test("should cancel with legacy { ids: string } format", async () => {
      const id = `wfr-${nanoid()}`;
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ ids: id });
          expect(result).toEqual({ cancelled: 1 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowRunIds=${id}`,
          token,
        },
      });
    });

    test("should cancel with legacy { ids: string[] } format", async () => {
      const ids = [`wfr-${nanoid()}`, `wfr-${nanoid()}`];
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ ids });
          expect(result).toEqual({ cancelled: 2 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowRunIds=${ids[0]}&workflowRunIds=${ids[1]}`,
          token,
        },
      });
    });

    test("should cancel with legacy { urlStartingWith } format", async () => {
      const urlStartingWith = "http://workflow-endpoint.com";
      await mockQStashServer({
        execute: async () => {
          const result = await client.cancel({ urlStartingWith });
          expect(result).toEqual({ cancelled: 3 });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 3 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?workflowUrl=${encodeURIComponent(urlStartingWith)}&count=100`,
          token,
        },
      });
    });

    test("should cancel with label filter", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { label: "test-label" } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?label=test-label&count=100`,
          token,
        },
      });
    });

    test("should cancel with fromDate and toDate filters", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { fromDate: 1640995200000, toDate: 1672531200000 } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?fromDate=1640995200000&toDate=1672531200000&count=100`,
          token,
        },
      });
    });

    test("should cancel with all filter fields", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({
            filter: {
              label: "my-workflow-label",
              fromDate: 1640995200000,
              toDate: 1672531200000,
            },
          });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 3 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?label=my-workflow-label&fromDate=1640995200000&toDate=1672531200000&count=100`,
          token,
        },
      });
    });

    test("should cancel with filters when only fromDate is provided", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { fromDate: 1640995200000 } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?fromDate=1640995200000&count=100`,
          token,
        },
      });
    });

    test("should cancel with filters when only toDate is provided", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { toDate: 1672531200000 } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?toDate=1672531200000&count=100`,
          token,
        },
      });
    });

    test("should cancel with fromDate and toDate as Date objects", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01
      const toDateMs = 1672531200000; // 2023-01-01

      await mockQStashServer({
        execute: async () => {
          await client.cancel({
            filter: {
              fromDate: new Date(fromDateMs),
              toDate: new Date(toDateMs),
            },
          });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 2 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?fromDate=${fromDateMs}&toDate=${toDateMs}&count=100`,
          token,
        },
      });
    });

    test("should cancel with only fromDate as Date object", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01

      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { fromDate: new Date(fromDateMs) } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?fromDate=${fromDateMs}&count=100`,
          token,
        },
      });
    });

    test("should cancel with only toDate as Date object", async () => {
      const toDateMs = 1672531200000; // 2023-01-01

      await mockQStashServer({
        execute: async () => {
          await client.cancel({ filter: { toDate: new Date(toDateMs) } });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 1 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?toDate=${toDateMs}&count=100`,
          token,
        },
      });
    });

    test("should cancel with mixed Date and number filters", async () => {
      const fromDateMs = 1640995200000; // 2022-01-01
      const toDateMs = 1672531200000; // 2023-01-01

      await mockQStashServer({
        execute: async () => {
          await client.cancel({
            filter: {
              label: "my-label",
              fromDate: new Date(fromDateMs),
              toDate: toDateMs,
            },
          });
        },
        responseFields: {
          status: 200,
          body: { cancelled: 3 },
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs?label=my-label&fromDate=${fromDateMs}&toDate=${toDateMs}&count=100`,
          token,
        },
      });
    });
  });

  describe("cancel - live", () => {
    const liveClient = new Client({
      baseUrl: process.env.QSTASH_URL,
      token: process.env.QSTASH_TOKEN!,
    });

    const liveBaseUrl = process.env.QSTASH_URL ?? "https://qstash.upstash.io";

    /** 200 while the run is live, 404 once it has been cancelled. */
    const isLive = async (workflowRunId: string) => {
      const response = await fetch(`${liveBaseUrl}/v2/workflows/runs/${workflowRunId}`, {
        headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN!}` },
      });
      return response.status === 200;
    };

    // Filter-based cancel is asynchronous server-side: QStash registers a "bulk
    // action", reports how many runs *matched* the filter at registration time,
    // and sweeps them in a background worker. So the `cancelled` count is a
    // snapshot rather than a result, re-issuing the same filter dedups onto the
    // in-flight action, and a run triggered moments ago may not be indexed yet.
    // Assert on the runs themselves instead: re-issue the cancel until every
    // targeted run is gone, then check the untargeted ones survived.
    const cancelUntilGone = async (
      request: WorkflowRunCancelFilters | { urlStartingWith: string },
      { cancels, keeps = [] }: { cancels: string[]; keeps?: string[] },
      timeoutMs = 25_000
    ) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await liveClient.cancel(request);
        const live = [];
        for (const id of cancels) if (await isLive(id)) live.push(id);
        if (live.length === 0) break;
        if (Date.now() > deadline) {
          throw new Error(`still live after cancelling with ${JSON.stringify(request)}: ${live}`);
        }
        await Bun.sleep(1000);
      }
      for (const id of keeps) {
        expect(await isLive(id)).toBe(true);
      }
    };

    /** Cancels leftovers by id — id-based cancel is synchronous and exact. */
    const cleanup = async (...workflowRunIds: string[]) => {
      for (const id of workflowRunIds) await liveClient.cancel(id).catch(() => {});
    };

    test(
      "should cancel single workflow run id",
      async () => {
        const { workflowRunId } = await liveClient.trigger({
          url: MOCK_DESTINATION_HOST,
        });

        const cancel = await liveClient.cancel(workflowRunId);
        expect(cancel).toEqual({ cancelled: 1 });

        const secondCancel = await liveClient.cancel(workflowRunId);
        expect(secondCancel).toEqual({ cancelled: 0 });
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should cancel multiple workflow run ids",
      async () => {
        const { workflowRunId: workflowRunIdOne } = await liveClient.trigger({
          url: MOCK_DESTINATION_HOST,
        });
        const { workflowRunId: workflowRunIdTwo } = await liveClient.trigger({
          url: MOCK_DESTINATION_HOST,
        });

        const firstCancel = await liveClient.cancel([
          workflowRunIdOne,
          workflowRunIdTwo,
          "non-existent",
        ]);
        expect(firstCancel).toEqual({ cancelled: 2 });

        // trying to cancel the workflows one by one gives error, as they were canceled above
        const secondCancel = await liveClient.cancel(workflowRunIdOne);
        expect(secondCancel).toEqual({ cancelled: 0 });

        // trying to cancel the workflows one by one gives error, as they were canceled above
        const thirdCancel = await liveClient.cancel(workflowRunIdTwo);
        expect(thirdCancel).toEqual({ cancelled: 0 });
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should cancel with workflowUrlStartingWith (prefix match)",
      async () => {
        // unique per run so leftovers from an earlier failed run can't interfere
        const prefix = `${MOCK_DESTINATION_HOST}/prefix-${nanoid()}/`;
        // delay keeps the runs pending: without it prod can deliver (and finish)
        // a run before the cancel lands
        const first = await liveClient.trigger({ url: `${prefix}first`, delay: "1m" });
        const second = await liveClient.trigger({ url: `${prefix}second`, delay: "1m" });

        try {
          await cancelUntilGone(
            { urlStartingWith: prefix },
            { cancels: [first.workflowRunId, second.workflowRunId] }
          );
        } finally {
          await cleanup(first.workflowRunId, second.workflowRunId);
        }
      },
      {
        timeout: 60000,
      }
    );

    test(
      "should cancel with label filter",
      async () => {
        const label = `test-label-${nanoid()}`;

        // delay keeps the runs pending: without it prod can deliver (and finish)
        // a run before the cancel-by-label lands
        const one = await liveClient.trigger({
          url: `${MOCK_DESTINATION_HOST}/label-test`,
          label,
          delay: "1m",
        });
        const two = await liveClient.trigger({
          url: `${MOCK_DESTINATION_HOST}/label-test`,
          label,
          delay: "1m",
        });
        // different label, should not be cancelled
        const other = await liveClient.trigger({
          url: `${MOCK_DESTINATION_HOST}/label-test`,
          label: `other-label-${nanoid()}`,
          delay: "1m",
        });

        try {
          await cancelUntilGone(
            { filter: { label } },
            { cancels: [one.workflowRunId, two.workflowRunId], keeps: [other.workflowRunId] }
          );
        } finally {
          await cleanup(one.workflowRunId, two.workflowRunId, other.workflowRunId);
        }
      },
      {
        timeout: 60000,
      }
    );

    test(
      "should cancel with workflowUrl (exact match)",
      async () => {
        // unique per run so leftovers from an earlier failed run can't interfere
        const base = `${MOCK_DESTINATION_HOST}/exact-match-${nanoid()}`;
        const exact = await liveClient.trigger({ url: base, delay: "1m" });
        const subPath = await liveClient.trigger({ url: `${base}/sub-path`, delay: "1m" });

        try {
          // exact match must leave the sub-path run alone
          await cancelUntilGone(
            { filter: { workflowUrl: base } },
            { cancels: [exact.workflowRunId], keeps: [subPath.workflowRunId] }
          );

          // prefix match then sweeps up the sub-path run
          await cancelUntilGone(
            { filter: { workflowUrlStartingWith: base } },
            { cancels: [subPath.workflowRunId] }
          );
        } finally {
          await cleanup(exact.workflowRunId, subPath.workflowRunId);
        }
      },
      {
        timeout: 90000,
      }
    );

    test(
      "should cancel with multiple workflowUrls (exact match, OR semantics)",
      async () => {
        const urlA = `${MOCK_DESTINATION_HOST}/multi-exact-a-${nanoid()}`;
        const urlB = `${MOCK_DESTINATION_HOST}/multi-exact-b-${nanoid()}`;
        const urlC = `${MOCK_DESTINATION_HOST}/multi-exact-c-${nanoid()}`;

        const a = await liveClient.trigger({ url: urlA, delay: "1m" });
        const b = await liveClient.trigger({ url: urlB, delay: "1m" });
        const c = await liveClient.trigger({ url: urlC, delay: "1m" });

        try {
          // Cancelling [urlA, urlB] with exact match cancels exactly those two, not urlC.
          await cancelUntilGone(
            { filter: { workflowUrl: [urlA, urlB] } },
            { cancels: [a.workflowRunId, b.workflowRunId], keeps: [c.workflowRunId] }
          );
        } finally {
          await cleanup(a.workflowRunId, b.workflowRunId, c.workflowRunId);
        }
      },
      {
        timeout: 60000,
      }
    );

    test(
      "should cancel with combined filters (label + workflowUrl)",
      async () => {
        const label = `combined-label-${nanoid()}`;
        // unique per run so leftovers from an earlier failed run can't interfere
        const url = `${MOCK_DESTINATION_HOST}/combined-${nanoid()}`;

        const target = await liveClient.trigger({ url, label, delay: "1m" });
        // same URL, different label — should NOT be cancelled
        const other = await liveClient.trigger({
          url,
          label: `other-${nanoid()}`,
          delay: "1m",
        });

        try {
          await cancelUntilGone(
            { filter: { workflowUrl: url, label } },
            { cancels: [target.workflowRunId], keeps: [other.workflowRunId] }
          );
        } finally {
          await cleanup(target.workflowRunId, other.workflowRunId);
        }
      },
      {
        timeout: 60000,
      }
    );

    test(
      "should cancel by destination host and path",
      async () => {
        // The hosts are shared across runs (prod refuses trigger URLs whose host
        // doesn't resolve, so they can't be made unique). The paths are unique,
        // and the assertions below are per run id, so leftovers can't interfere.
        const comPath = `/cancel-host-com-${nanoid()}`;
        const orgPath = `/cancel-host-org-${nanoid()}`;

        const com = await liveClient.trigger({
          url: `https://example.com${comPath}`,
          delay: "1m",
        });
        const org = await liveClient.trigger({
          url: `https://example.org${orgPath}`,
          delay: "1m",
        });

        try {
          // host example.org must not touch the example.com run
          await cancelUntilGone(
            { filter: { host: "example.org" } },
            { cancels: [org.workflowRunId], keeps: [com.workflowRunId] }
          );

          // the example.com run survived — cancel it via its unique path
          await cancelUntilGone({ filter: { path: comPath } }, { cancels: [com.workflowRunId] });
        } finally {
          await cleanup(com.workflowRunId, org.workflowRunId);
        }
      },
      {
        timeout: 90000,
      }
    );

    test.skip(
      "should cancel all",
      async () => {
        await liveClient.trigger({ url: `${MOCK_DESTINATION_HOST}/cancel-all-1` });
        await liveClient.trigger({ url: `${MOCK_DESTINATION_HOST}/cancel-all-2` });

        const cancel = await liveClient.cancel({ all: true });
        expect(cancel.cancelled).toBeGreaterThanOrEqual(2);
      },
      { timeout: 15000 }
    );

    test(
      "should trigger with multiple labels (comma-separated header)",
      async () => {
        // Two runs, each with its own label pair, so cancelling by one run's
        // label can't consume the other run and mask a missing label.
        const labels = { first: ["a1", "b1"], second: ["a2", "b2"] } as const;
        const suffix = nanoid();
        const withSuffix = (parts: readonly string[]) => parts.map((p) => `multi-${p}-${suffix}`);

        const first = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: withSuffix(labels.first),
          delay: "1m",
        });
        const second = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: withSuffix(labels.second),
          delay: "1m",
        });

        try {
          // the *second* label of the header must match its run on its own
          await cancelUntilGone(
            { filter: { label: withSuffix(labels.first)[1] } },
            { cancels: [first.workflowRunId], keeps: [second.workflowRunId] }
          );

          // ...and so must the first
          await cancelUntilGone(
            { filter: { label: withSuffix(labels.second)[0] } },
            { cancels: [second.workflowRunId] }
          );
        } finally {
          // safety net in case the assertions above didn't cancel
          await cleanup(first.workflowRunId, second.workflowRunId);
        }
      },
      { timeout: 90000 }
    );
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

  test("should send notify with workflowRunId", async () => {
    const eventId = `event-id-${nanoid()}`;
    const workflowRunId = `wfr_${nanoid()}`;
    const eventData = { data: `notify-data-${nanoid()}` };
    await mockQStashServer({
      execute: async () => {
        await client.notify({ eventId, eventData, workflowRunId });
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/notify/${workflowRunId}/${eventId}`,
        token,
        body: eventData,
      },
    });
  });

  test("should not send notify request when eventId is an empty string", async () => {
    await mockQStashServer({
      execute: async () => {
        await expect(client.notify({ eventId: "", eventData: "data" })).rejects.toThrow(
          "Event id cannot be empty"
        );
      },
      responseFields: { status: 200, body: {} },
      receivesRequest: false,
    });
  });

  test("should not send getWaiters request when eventId is an empty string", async () => {
    await mockQStashServer({
      execute: async () => {
        await expect(client.getWaiters({ eventId: "" })).rejects.toThrow(
          "Event id cannot be empty"
        );
      },
      responseFields: { status: 200, body: {} },
      receivesRequest: false,
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
          retryDelay: "1000",
          delay: 1,
          label: "test-label",
        });
      },
      responseFields: {
        status: 200,
        body: [{ messageId: "msgId" }],
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-user-header": "user-header-value",
              "upstash-method": "POST",
              "upstash-retries": "15",
              "upstash-retry-delay": "1000",
              "upstash-workflow-init": "true",
              "upstash-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-delay": "1s",
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-forward-upstash-label": "test-label",
              "upstash-label": "test-label",
              "upstash-telemetry-framework": "unknown",
              "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
              "upstash-telemetry-sdk": expect.stringContaining("@upstash/workflow"),
              "upstash-workflow-sdk-version": "1",
              "upstash-failure-callback-forward-upstash-label": "test-label",
              "upstash-failure-callback": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-failure-callback-feature-set":
                "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
              "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
              "upstash-failure-callback-forward-user-header": "user-header-value",
              "upstash-failure-callback-retries": "15",
              "upstash-failure-callback-retry-delay": "1000",
              "upstash-failure-callback-workflow-calltype": "failureCall",
              "upstash-failure-callback-workflow-init": "false",
              "upstash-failure-callback-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-failure-callback-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
            },
            body,
          },
        ],
      },
    });
  });

  test("should trigger multiple workflow runs", async () => {
    const myWorkflowRunId = `mock-${getWorkflowRunId()}`;
    const myWorkflowRunId2 = `mock-${getWorkflowRunId()}`;
    const body = "request-body";
    const body2 = "request-body-2";
    await mockQStashServer({
      execute: async () => {
        const result = await client.trigger([
          {
            url: WORKFLOW_ENDPOINT,
            body,
            headers: { "user-header": "user-header-value" },
            workflowRunId: myWorkflowRunId,
            retries: 15,
            retryDelay: "1000",
            delay: 1,
          },
          {
            url: WORKFLOW_ENDPOINT,
            body: body2,
            headers: { "user-header": "user-header-value" },
            workflowRunId: myWorkflowRunId2,
            retries: 15,
            retryDelay: "2000",
            notBefore: new Date("2100-01-01T00:00:00Z").getTime() / 1000,
          },
        ]);
        expect(result).toEqual([
          { workflowRunId: `wfr_${myWorkflowRunId}` },
          { workflowRunId: `wfr_${myWorkflowRunId2}` },
        ]);
      },
      responseFields: {
        status: 200,
        body: [{ messageId: "msgId" }],
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-user-header": "user-header-value",
              "upstash-method": "POST",
              "upstash-retries": "15",
              "upstash-retry-delay": "1000",
              "upstash-workflow-init": "true",
              "upstash-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-delay": "1s",
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-telemetry-framework": "unknown",
              "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
              "upstash-telemetry-sdk": expect.stringContaining("@upstash/workflow"),
              "upstash-workflow-sdk-version": "1",
              "upstash-failure-callback": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-failure-callback-feature-set":
                "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
              "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
              "upstash-failure-callback-forward-user-header": "user-header-value",
              "upstash-failure-callback-retries": "15",
              "upstash-failure-callback-retry-delay": "1000",
              "upstash-failure-callback-workflow-calltype": "failureCall",
              "upstash-failure-callback-workflow-init": "false",
              "upstash-failure-callback-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-failure-callback-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
            },
            body,
          },
          {
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-user-header": "user-header-value",
              "upstash-method": "POST",
              "upstash-retries": "15",
              "upstash-retry-delay": "2000",
              "upstash-workflow-init": "true",
              "upstash-workflow-runid": `wfr_${myWorkflowRunId2}`,
              "upstash-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-not-before": "4102444800",
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-telemetry-framework": "unknown",
              "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
              "upstash-telemetry-sdk": expect.stringContaining("@upstash/workflow"),
              "upstash-workflow-sdk-version": "1",
              "upstash-failure-callback": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-failure-callback-feature-set":
                "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
              "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
              "upstash-failure-callback-forward-user-header": "user-header-value",
              "upstash-failure-callback-retries": "15",
              "upstash-failure-callback-retry-delay": "2000",
              "upstash-failure-callback-workflow-calltype": "failureCall",
              "upstash-failure-callback-workflow-init": "false",
              "upstash-failure-callback-workflow-runid": `wfr_${myWorkflowRunId2}`,
              "upstash-failure-callback-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
            },
            body: body2,
          },
        ],
      },
    });
  });

  test("should trigger workflow run with failure callback", async () => {
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
          retryDelay: "1000",
          delay: 1,
          failureUrl: `${MOCK_DESTINATION_HOST}/some-failure-callback`,
          flowControl: {
            key: "failure-flow-key",
            rate: 5,
            parallelism: 2,
            period: "1m",
          },
        });
      },
      responseFields: {
        status: 200,
        body: [{ messageId: "msgId" }],
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-forward-user-header": "user-header-value",
              "upstash-method": "POST",
              "upstash-retries": "15",
              "upstash-retry-delay": "1000",
              "upstash-workflow-init": "true",
              "upstash-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-delay": "1s",
              "upstash-failure-callback": `${MOCK_DESTINATION_HOST}/some-failure-callback`,
              "content-type": "application/json",
              "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-failure-callback-feature-set":
                "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
              "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
              "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
              "upstash-failure-callback-forward-user-header": "user-header-value",
              "upstash-failure-callback-retries": "15",
              "upstash-failure-callback-retry-delay": "1000",
              "upstash-failure-callback-workflow-calltype": "failureCall",
              "upstash-failure-callback-workflow-init": "false",
              "upstash-failure-callback-workflow-runid": `wfr_${myWorkflowRunId}`,
              "upstash-failure-callback-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              "upstash-telemetry-framework": "unknown",
              "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
              "upstash-telemetry-sdk": expect.stringContaining("@upstash/workflow"),
              "upstash-workflow-sdk-version": "1",
              "upstash-flow-control-key": "failure-flow-key",
              "upstash-flow-control-value": "parallelism=2, rate=5, period=1m",
              "upstash-failure-callback-flow-control-key": "failure-flow-key",
              "upstash-failure-callback-flow-control-value": "parallelism=2, rate=5, period=1m",
            },
            body,
          },
        ],
      },
    });
  });

  test("should trigger workflow run with redact fields", async () => {
    const myWorkflowRunId = `mock-${getWorkflowRunId()}`;
    const body = "request-body";
    await mockQStashServer({
      execute: async () => {
        await client.trigger({
          url: WORKFLOW_ENDPOINT,
          body,
          workflowRunId: myWorkflowRunId,
          redact: { body: true, header: ["Authorization"] },
        });
      },
      responseFields: {
        status: 200,
        body: [{ messageId: "msgId" }],
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: expect.objectContaining({
              "upstash-redact-fields": "body,header[Authorization]",
            }),
            body,
          },
        ],
      },
    });
  });

  test("should trigger workflow run with redact fields and failure callback", async () => {
    const myWorkflowRunId = `mock-${getWorkflowRunId()}`;
    const body = "request-body";
    await mockQStashServer({
      execute: async () => {
        await client.trigger({
          url: WORKFLOW_ENDPOINT,
          body,
          workflowRunId: myWorkflowRunId,
          redact: { body: true, header: true },
          failureUrl: `${MOCK_DESTINATION_HOST}/some-failure-callback`,
        });
      },
      responseFields: {
        status: 200,
        body: [{ messageId: "msgId" }],
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            destination: WORKFLOW_ENDPOINT,
            headers: expect.objectContaining({
              "upstash-redact-fields": "body,header",
            }),
            body,
          },
        ],
      },
    });
  });

  describe("logs", () => {
    test("should send logs request", async () => {
      const count = 10;
      const cursor = "cursor";
      const state = "RUN_FAILED";
      const workflowCreatedAt = 123;
      const workflowRunId = "wfr-123";
      const workflowUrl = "https://workflow-url.com";

      await mockQStashServer({
        execute: async () => {
          await client.logs({
            filter: {
              state,
              workflowCreatedAt,
              workflowRunId,
              workflowUrl,
            },
            count,
            cursor,
          });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "GET",
          url:
            `${MOCK_QSTASH_SERVER_URL}/v2/workflows/events?groupBy=workflowRunId` +
            `&cursor=${cursor}` +
            `&count=${count}` +
            `&state=${state}` +
            `&workflowCreatedAt=${workflowCreatedAt}` +
            `&workflowRunId=${workflowRunId}` +
            `&workflowUrl=${encodeURIComponent(workflowUrl)}`,
          token,
          body: "",
        },
      });
    });

    test("should send logs request with label filter", async () => {
      const label = "my-workflow-label";

      await mockQStashServer({
        execute: async () => {
          await client.logs({ label });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "GET",
          url:
            `${MOCK_QSTASH_SERVER_URL}/v2/workflows/events?groupBy=workflowRunId` +
            `&label=${label}`,
          token,
          body: "",
        },
      });
    });

    test("should send logs request with multiple labels (OR filter)", async () => {
      await mockQStashServer({
        execute: async () => {
          await client.logs({ filter: { label: ["label-a", "label-b"] } });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "GET",
          url:
            `${MOCK_QSTASH_SERVER_URL}/v2/workflows/events?groupBy=workflowRunId` +
            `&label=label-a&label=label-b`,
          token,
          body: "",
        },
      });
    });

    test("should send logs request with all parameters including label", async () => {
      const count = 5;
      const cursor = "cursor-abc";
      const state = "RUN_SUCCESS";
      const workflowCreatedAt = 456;
      const workflowRunId = "wfr-456";
      const workflowUrl = "https://workflow-url.com";
      const label = "my-workflow-label";

      await mockQStashServer({
        execute: async () => {
          await client.logs({
            count,
            cursor,
            state,
            workflowCreatedAt,
            workflowRunId,
            workflowUrl,
            label,
          });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "GET",
          url:
            `${MOCK_QSTASH_SERVER_URL}/v2/workflows/events?groupBy=workflowRunId` +
            `&state=${state}` +
            `&workflowCreatedAt=${workflowCreatedAt}` +
            `&workflowRunId=${workflowRunId}` +
            `&workflowUrl=${encodeURIComponent(workflowUrl)}` +
            `&label=${label}` +
            `&cursor=${cursor}` +
            `&count=${count}`,
          token,
          body: "",
        },
      });
    });

    test(
      "should return both labels in the log entry - live",
      async () => {
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        const labelOne = `log-label-a-${nanoid()}`;
        const labelTwo = `log-label-b-${nanoid()}`;

        const { workflowRunId } = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: [labelOne, labelTwo],
          delay: "1m",
        });

        try {
          await eventually(
            async () => {
              const logs = await liveClient.logs({ workflowRunId });
              expect(logs.runs.length).toBe(1);

              const run = logs.runs[0];

              // legacy `label` only carries the first label
              expect(run.label).toBe(labelOne);
              // new `labels` carries all of them
              expect(run.labels).toEqual([labelOne, labelTwo]);
            },
            { timeout: 5000, interval: 250 }
          );
        } finally {
          await liveClient.cancel(workflowRunId).catch(() => {});
        }
      },
      { timeout: 15000 }
    );

    test(
      "should filter logs by multiple labels (OR) - live",
      async () => {
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        // unique label per slot so the filter only matches runs from this test
        const labelOne = `or-1-${nanoid()}`;
        const labelTwo = `or-2-${nanoid()}`;
        const labelThree = `or-3-${nanoid()}`;

        // run 1: [labelOne, labelTwo]
        // run 2: [labelTwo, labelThree]
        // run 3 (control): [labelThree]
        const { workflowRunId: runOneTwo } = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: [labelOne, labelTwo],
          delay: "1m",
        });
        const { workflowRunId: runTwoThree } = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: [labelTwo, labelThree],
          delay: "1m",
        });
        const { workflowRunId: runThree } = await liveClient.trigger({
          url: "https://mock.httpstatus.io/200",
          label: labelThree,
          delay: "1m",
        });

        try {
          // filtering by [labelOne, labelTwo] should return runOneTwo (matches both)
          // and runTwoThree (shares labelTwo), but NOT runThree.
          await eventually(
            async () => {
              const logs = await liveClient.logs({
                filter: { label: [labelOne, labelTwo] },
              });
              const ids = logs.runs.map((r) => r.workflowRunId);
              expect(ids).toContain(runOneTwo);
              expect(ids).toContain(runTwoThree);
              expect(ids).not.toContain(runThree);
            },
            { timeout: 5000, interval: 250 }
          );
        } finally {
          await liveClient.cancel([runOneTwo, runTwoThree, runThree]).catch(() => {});
        }
      },
      { timeout: 20000 }
    );

    test(
      "should filter logs by multiple workflowUrls (OR) - live",
      async () => {
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        // unique urls so the filter only matches runs from this test
        const urlA = `${MOCK_DESTINATION_HOST}/log-url-a-${nanoid()}`;
        const urlB = `${MOCK_DESTINATION_HOST}/log-url-b-${nanoid()}`;
        const urlC = `${MOCK_DESTINATION_HOST}/log-url-c-${nanoid()}`;

        const { workflowRunId: runA } = await liveClient.trigger({ url: urlA, delay: "1m" });
        const { workflowRunId: runB } = await liveClient.trigger({ url: urlB, delay: "1m" });
        const { workflowRunId: runC } = await liveClient.trigger({ url: urlC, delay: "1m" });

        try {
          // filtering by [urlA, urlB] should return runA and runB but NOT runC.
          await eventually(
            async () => {
              const logs = await liveClient.logs({ filter: { workflowUrl: [urlA, urlB] } });
              const ids = logs.runs.map((r) => r.workflowRunId);
              expect(ids).toContain(runA);
              expect(ids).toContain(runB);
              expect(ids).not.toContain(runC);
            },
            { timeout: 5000, interval: 250 }
          );
        } finally {
          await liveClient.cancel([runA, runB, runC]).catch(() => {});
        }
      },
      { timeout: 20000 }
    );

    test(
      "should filter logs by destination host and path - live",
      async () => {
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        const comPath = `/log-host-com-${nanoid()}`;
        const orgPath = `/log-host-org-${nanoid()}`;

        const { workflowRunId: comRun } = await liveClient.trigger({
          url: `https://example.com${comPath}`,
          delay: "1m",
        });
        const { workflowRunId: orgRun } = await liveClient.trigger({
          url: `https://example.org${orgPath}`,
          delay: "1m",
        });

        try {
          // host discriminates: example.org excludes the example.com run
          await eventually(
            async () => {
              const logs = await liveClient.logs({ filter: { host: "example.org" } });
              const ids = logs.runs.map((r) => r.workflowRunId);
              expect(ids).toContain(orgRun);
              expect(ids).not.toContain(comRun);
            },
            { timeout: 10000, interval: 500 }
          );

          // path discriminates: the unique example.com path excludes the example.org run
          await eventually(
            async () => {
              const logs = await liveClient.logs({ filter: { path: comPath } });
              const ids = logs.runs.map((r) => r.workflowRunId);
              expect(ids).toContain(comRun);
              expect(ids).not.toContain(orgRun);
            },
            { timeout: 10000, interval: 500 }
          );
        } finally {
          await liveClient.cancel([comRun, orgRun]).catch(() => {});
        }
      },
      { timeout: 25000 }
    );

    test.skip(
      "should get logs - live",
      async () => {
        const qstashClient = new QStashClient({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        const body = "some-body";
        const workflowRunId = "wfr_some-workflow-run-id-" + nanoid();

        const result = await triggerFirstInvocation({
          workflowContext: new WorkflowContext({
            qstashClient,
            headers: new Headers({}) as Headers,
            initialPayload: body,
            workflowRunId,
            steps: [],
            url: "https://httpstat.us/200",
            workflowRunCreatedAt: 0,
          }),
        });

        expect(result.isOk()).toBe(true);

        await eventually(
          async () => {
            const logs = await liveClient.logs({
              workflowRunId,
            });

            expect(logs.cursor).toBeUndefined();
            expect(logs.runs.length).toBe(1);
            expect(logs.runs[0]).toEqual({
              workflowRunId,
              workflowUrl: "https://httpstat.us/200",
              workflowState: "RUN_STARTED",
              workflowRunCreatedAt: expect.any(Number),
              steps: [
                {
                  steps: [
                    {
                      callType: "step",
                      concurrent: 1,
                      createdAt: expect.any(Number),
                      headers: {
                        "Content-Type": ["application/json"],
                        "Upstash-Workflow-Sdk-Version": ["1"],
                      },
                      messageId: expect.any(String),
                      out: "some-body",
                      retries: 3,
                      state: "STEP_SUCCESS",
                      stepName: "init",
                      stepType: "Initial",
                      retryDelay: expect.any(String),
                    },
                  ],
                  type: "sequential",
                },
                {
                  steps: [
                    {
                      messageId: expect.any(String),
                      retries: 3,
                      errors: expect.any(Array),
                      state: "STEP_RETRY",
                      retryDelay: expect.any(String),
                    },
                  ],
                  type: "next",
                },
              ],
            });
          },
          { timeout: 1000, interval: 100 }
        );

        await liveClient.cancel(workflowRunId);

        await eventually(
          async () => {
            const postCancelLogs = await liveClient.logs({
              workflowRunId,
            });

            expect(postCancelLogs.cursor).toBeUndefined();
            expect(postCancelLogs.runs.length).toBe(1);
            expect(postCancelLogs.runs[0]).toEqual({
              workflowRunId,
              workflowUrl: "https://httpstat.us/200",
              workflowState: "RUN_CANCELED",
              workflowRunCreatedAt: expect.any(Number),
              workflowRunCompletedAt: expect.any(Number),
              steps: [
                {
                  steps: [
                    {
                      callType: "step",
                      concurrent: 1,
                      createdAt: expect.any(Number),
                      headers: {
                        "Content-Type": ["application/json"],
                        "Upstash-Workflow-Sdk-Version": ["1"],
                      },
                      messageId: expect.any(String),
                      out: "some-body",
                      retries: 3,
                      state: "STEP_SUCCESS",
                      stepName: "init",
                      stepType: "Initial",
                      retryDelay: expect.any(String),
                    },
                  ],
                  type: "sequential",
                },
                {
                  steps: [
                    {
                      messageId: expect.any(String),
                      retries: 3,
                      errors: expect.any(Array),
                      state: "STEP_CANCELED",
                      retryDelay: expect.any(String),
                    },
                  ],
                  type: "next",
                },
              ],
            });
          },
          { timeout: 30_000, interval: 100 }
        );
      },
      {
        timeout: 60000,
      }
    );

    // skipping test as the httpstat service is removed and we don't have a replacement
    // for it yet.
    test.skip(
      "should include failure logs in case of failure",
      async () => {
        const qstashClient = new QStashClient({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });
        const liveClient = new Client({
          baseUrl: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN!,
        });

        const body = "some-body";
        const workflowRunId = "wfr_some-workflow-run-id-" + nanoid();

        const result = await triggerFirstInvocation({
          workflowContext: new WorkflowContext({
            qstashClient,
            headers: new Headers({}) as Headers,
            initialPayload: body,
            workflowRunId,
            steps: [],
            url: "https://httpstat.us/400",
            workflowRunCreatedAt: 0,
          }),
          failureUrl: `${MOCK_DESTINATION_HOST}/`,
          retries: 0,
        });
        expect(result.isOk()).toBe(true);

        await eventually(
          async () => {
            const logs = await liveClient.logs({
              workflowRunId,
            });

            expect(logs.cursor).toBeUndefined();
            expect(logs.runs.length).toBe(1);
            expect(logs.runs[0]).toEqual({
              workflowRunId,
              workflowUrl: "https://httpstat.us/400",
              workflowState: "RUN_FAILED",
              workflowRunCreatedAt: expect.any(Number),
              workflowRunCompletedAt: expect.any(Number),
              dlqId: expect.any(String),
              failureFunction: {
                messageId: expect.any(String),
                failResponse: "400 Bad Request",
                failStatus: 400,
                url: "https://httpstat.us/400",
                state: "CALLBACK_SUCCESS",
                failHeaders: expect.any(Object),
                dlqId: expect.any(String),
              },
              steps: [
                {
                  steps: [
                    {
                      callType: "step",
                      concurrent: 1,
                      createdAt: expect.any(Number),
                      headers: {
                        "Content-Type": ["application/json"],
                        "Upstash-Workflow-Sdk-Version": ["1"],
                      },
                      messageId: expect.any(String),
                      out: "some-body",
                      retries: 0,
                      state: "STEP_SUCCESS",
                      stepName: "init",
                      stepType: "Initial",
                    },
                  ],
                  type: "sequential",
                },
                {
                  steps: [
                    {
                      state: "STEP_FAILED",
                      messageId: expect.any(String),
                      retries: 0,
                      errors: [
                        {
                          error: "400 Bad Request",
                          body: expect.any(String),
                          headers: expect.any(Object),
                          status: 400,
                          time: expect.any(Number),
                        },
                      ],
                    },
                  ],
                  type: "next",
                },
              ],
            });
          },
          { timeout: 30_000, interval: 1000 }
        );
      },
      {
        timeout: 60000,
      }
    );
  });

  describe("trigger - input validation", () => {
    test("should throw when label contains invalid characters", () => {
      const promise = client.trigger({
        url: WORKFLOW_ENDPOINT,
        label: "bad label!",
      });
      expect(promise).rejects.toThrow(WorkflowNonRetryableError);
      expect(promise).rejects.toThrow(/Invalid label/);
    });

    test("should throw when flowControl key contains invalid characters", () => {
      const promise = client.trigger({
        url: WORKFLOW_ENDPOINT,
        flowControl: { key: "bad key!", parallelism: 1 },
      });
      expect(promise).rejects.toThrow(WorkflowNonRetryableError);
      expect(promise).rejects.toThrow(/Invalid flow control key/);
    });

    test("should forward valid label and flow control headers", async () => {
      const myWorkflowRunId = `mock-${getWorkflowRunId()}`;
      await mockQStashServer({
        execute: async () => {
          await client.trigger({
            url: WORKFLOW_ENDPOINT,
            workflowRunId: myWorkflowRunId,
            label: "valid_label.1",
            flowControl: { key: "valid-key_1.0", parallelism: 5 },
          });
        },
        responseFields: {
          status: 200,
          body: [{ messageId: "msgId" }],
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-workflow-init": "true",
                "upstash-workflow-runid": `wfr_${myWorkflowRunId}`,
                "upstash-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
                "content-type": "application/json",
                "upstash-feature-set": "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-forward-upstash-label": "valid_label.1",
                "upstash-label": "valid_label.1",
                "upstash-flow-control-key": "valid-key_1.0",
                "upstash-flow-control-value": "parallelism=5",
                "upstash-telemetry-framework": "unknown",
                "upstash-telemetry-runtime": expect.stringMatching(/bun@/),
                "upstash-telemetry-sdk": expect.stringContaining("@upstash/workflow"),
                "upstash-workflow-sdk-version": "1",
                "upstash-failure-callback-forward-upstash-label": "valid_label.1",
                "upstash-failure-callback": `${MOCK_DESTINATION_HOST}/api`,
                "upstash-failure-callback-feature-set":
                  "LazyFetch,InitialBody,WF_DetectTrigger,WF_TriggerOnConfig",
                "upstash-failure-callback-flow-control-key": "valid-key_1.0",
                "upstash-failure-callback-flow-control-value": "parallelism=5",
                "upstash-failure-callback-forward-upstash-workflow-failure-callback": "true",
                "upstash-failure-callback-forward-upstash-workflow-is-failure": "true",
                "upstash-failure-callback-workflow-calltype": "failureCall",
                "upstash-failure-callback-workflow-init": "false",
                "upstash-failure-callback-workflow-runid": `wfr_${myWorkflowRunId}`,
                "upstash-failure-callback-workflow-url": `${MOCK_DESTINATION_HOST}/api`,
              },
            },
          ],
        },
      });
    });
  });
});
