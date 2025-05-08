import { describe, test, expect } from "bun:test";
import {
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
  eventually,
} from "../test-utils";
import { Client } from ".";
import { Client as QStashClient } from "@upstash/qstash";
import { getWorkflowRunId, nanoid } from "../utils";
import { triggerFirstInvocation } from "../workflow-requests";
import { WorkflowContext } from "../context";

describe("workflow client", () => {
  const token = nanoid();
  const client = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

  describe("cancel - mocked", () => {
    test("should cancel single workflow run id", async () => {
      const ids = `wfr-${nanoid()}`;
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ ids });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowRunIds: [ids] },
        },
      });
    });

    test("should cancel multiple workflow run ids", async () => {
      const ids = [`wfr-${nanoid()}`, `wfr-${nanoid()}`];
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ ids });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowRunIds: ids },
        },
      });
    });

    test("should cancel workflowUrl", async () => {
      const urlStartingWith = "http://workflow-endpoint.com";
      await mockQStashServer({
        execute: async () => {
          await client.cancel({ urlStartingWith });
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs`,
          token,
          body: { workflowUrl: urlStartingWith },
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

    test(
      "should cancel single workflow run id",
      async () => {
        const { workflowRunId } = await liveClient.trigger({
          url: "http://requestcatcher.com",
        });

        const cancel = await liveClient.cancel({
          ids: workflowRunId,
        });
        expect(cancel).toEqual({ cancelled: 1 });

        const secondCancel = await liveClient.cancel({ ids: workflowRunId });
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
          url: "http://requestcatcher.com",
        });
        const { workflowRunId: workflowRunIdTwo } = await liveClient.trigger({
          url: "http://requestcatcher.com",
        });

        const firstCancel = await liveClient.cancel({
          ids: [workflowRunIdOne, workflowRunIdTwo, "non-existent"],
        });
        expect(firstCancel).toEqual({ cancelled: 2 });

        // trying to cancel the workflows one by one gives error, as they were canceled above
        const secondCancel = await liveClient.cancel({ ids: workflowRunIdOne });
        expect(secondCancel).toEqual({ cancelled: 0 });

        // trying to cancel the workflows one by one gives error, as they were canceled above
        const thirdCancel = await liveClient.cancel({ ids: workflowRunIdTwo });
        expect(thirdCancel).toEqual({ cancelled: 0 });
      },
      {
        timeout: 10000,
      }
    );

    test(
      "should cancel workflowUrl",
      async () => {
        await liveClient.trigger({
          url: "http://requestcatcher.com/first",
        });
        await liveClient.trigger({
          url: "http://requestcatcher.com/second",
        });

        const cancel = await liveClient.cancel({
          urlStartingWith: "http://requestcatcher.com",
        });

        expect(cancel).toEqual({ cancelled: 2 });
      },
      {
        timeout: 10000,
      }
    );

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
          delay: 1,
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
          "upstash-workflow-url": "https://requestcatcher.com/api",
          "upstash-delay": "1s",
        },
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
            count,
            cursor,
            state,
            workflowCreatedAt,
            workflowRunId,
            workflowUrl,
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
            `&workflowRunId=${workflowRunId}` +
            `&cursor=${cursor}` +
            `&count=${count}` +
            `&state=${state}` +
            `&workflowUrl=${encodeURIComponent(workflowUrl)}` +
            `&workflowCreatedAt=${workflowCreatedAt}`,
          token,
          body: "",
        },
      });
    });

    test(
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
          }),
        });
        expect(result.isOk()).toBe(true);

        await eventually(
          async () => {
            const logs = await liveClient.logs({
              workflowRunId,
            });

            expect(logs.cursor).toBe("");
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
                      state: "STEP_SUCCESS",
                      stepName: "init",
                      stepType: "Initial",
                    },
                  ],
                  type: "sequential",
                },
              ],
            });
          },
          { timeout: 30_000, interval: 100 }
        );

        await liveClient.cancel({ ids: workflowRunId });

        await eventually(
          async () => {
            const postCancelLogs = await liveClient.logs({
              workflowRunId,
            });

            expect(postCancelLogs.cursor).toBe("");
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
                      state: "STEP_SUCCESS",
                      stepName: "init",
                      stepType: "Initial",
                    },
                  ],
                  type: "sequential",
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

    test(
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
            failureUrl: "https://httpstat.us/200",
            retries: 0,
          }),
        });
        expect(result.isOk()).toBe(true);

        await eventually(
          async () => {
            const logs = await liveClient.logs({
              workflowRunId,
            });

            expect(logs.cursor).toBe("");
            expect(logs.runs.length).toBe(1);
            expect(logs.runs[0]).toEqual({
              workflowRunId,
              workflowUrl: "https://httpstat.us/400",
              workflowState: "RUN_FAILED",
              workflowRunCreatedAt: expect.any(Number),
              workflowRunCompletedAt: expect.any(Number),
              failureFunction: {
                messageId: expect.any(String),
                dlqId: expect.any(String),
                failResponse: "400 Bad Request",
                failStatus: 400,
                url: "https://httpstat.us/400",
                state: "DELIVERED",
                failHeaders: expect.any(Object),
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
  });
});
