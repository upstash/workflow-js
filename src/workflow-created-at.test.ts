import { describe, expect, spyOn, test } from "bun:test";
import { Client } from "@upstash/qstash";

import { WorkflowContext } from "./context";
import { LazyCallStep, LazyFunctionStep, LazyWaitForEventStep } from "./context/steps";
import { WORKFLOW_CREATED_AT_HEADER, WORKFLOW_ID_HEADER } from "./constants";
import { getHeaders } from "./qstash/headers";
import { submitParallelSteps } from "./qstash/submit-steps";
import { serve } from "./serve";
import {
  getRequest,
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
} from "./test-utils";
import { nanoid } from "./utils";
import {
  handleThirdPartyCallResult,
  triggerFirstInvocation,
  triggerWorkflowDelete,
} from "./workflow-requests";
import { WorkflowAbort } from "./error";

/**
 * QStash includes `Upstash-Workflow-CreatedAt` in the deduplication of workflow
 * requests. The SDK sends it on every request of a run, so that a run started
 * with the same workflow run id and the same data as a finished run is not
 * deduplicated against it.
 */
describe("Upstash-Workflow-CreatedAt", () => {
  const token = nanoid();
  const workflowRunCreatedAt = 1_790_000_000_123;

  const getContext = (createdAt: number, workflowRunId = `wfr_${nanoid()}`) =>
    new WorkflowContext({
      qstashClient: new Client({
        baseUrl: MOCK_QSTASH_SERVER_URL,
        token,
        retry: false,
        enableTelemetry: false,
      }),
      workflowRunId,
      initialPayload: "initial-payload",
      headers: new Headers({}) as Headers,
      steps: [],
      url: WORKFLOW_ENDPOINT,
      workflowRunCreatedAt: createdAt,
    });

  describe("getHeaders", () => {
    test("should add the header when the creation time is set", () => {
      const { headers } = getHeaders({
        initHeaderValue: "false",
        workflowConfig: {
          workflowRunId: "wfr_id",
          workflowUrl: WORKFLOW_ENDPOINT,
          workflowRunCreatedAt,
        },
      });
      expect(headers[WORKFLOW_CREATED_AT_HEADER]).toBe(workflowRunCreatedAt.toString());
    });

    test("should not add the header when the creation time is not known", () => {
      for (const createdAt of [0, Number.NaN]) {
        const { headers } = getHeaders({
          initHeaderValue: "false",
          workflowConfig: {
            workflowRunId: "wfr_id",
            workflowUrl: WORKFLOW_ENDPOINT,
            workflowRunCreatedAt: createdAt,
          },
        });
        expect(headers).not.toHaveProperty(WORKFLOW_CREATED_AT_HEADER);
      }
    });
  });

  describe("steps", () => {
    test("should send the creation time of the run with a step", async () => {
      const context = getContext(workflowRunCreatedAt);
      const lazyStep = new LazyFunctionStep(context, "step", () => "result");
      const { headers } = lazyStep.getHeaders({
        context,
        step: await lazyStep.getResultStep(1, 1),
        invokeCount: 0,
      });
      expect(headers[WORKFLOW_CREATED_AT_HEADER]).toBe(workflowRunCreatedAt.toString());
    });

    test("should send the creation time with a wait and its timeout message", async () => {
      const context = getContext(workflowRunCreatedAt);
      const lazyStep = new LazyWaitForEventStep(context, "wait", "event-id", "20s");
      const step = await lazyStep.getResultStep(1, 1);
      const { headers } = lazyStep.getHeaders({ context, step, invokeCount: 0 });
      const body = JSON.parse(lazyStep.getBody({ context, step, headers, invokeCount: 0 })) as {
        timeoutHeaders: Record<string, string[]>;
      };

      // QStash reads it from the headers of the wait request for the deduplication
      expect(headers[WORKFLOW_CREATED_AT_HEADER]).toBe(workflowRunCreatedAt.toString());
      // and the timeout message is sent to the workflow with the same headers
      expect(body.timeoutHeaders[WORKFLOW_CREATED_AT_HEADER]).toEqual([
        workflowRunCreatedAt.toString(),
      ]);
    });

    test("should send the creation time with context.call", async () => {
      const context = getContext(workflowRunCreatedAt);
      const lazyStep = new LazyCallStep({
        context,
        stepName: "call",
        url: "https://some-endpoint.com",
        method: "POST",
        body: "call-body",
        headers: {},
        retries: 0,
      });
      const { headers } = lazyStep.getHeaders({
        context,
        step: await lazyStep.getResultStep(1, 1),
        invokeCount: 0,
      });
      expect(headers[WORKFLOW_CREATED_AT_HEADER]).toBe(workflowRunCreatedAt.toString());
    });

    test("should send the creation time with parallel steps", async () => {
      const context = getContext(workflowRunCreatedAt);
      const steps = [
        new LazyFunctionStep(context, "first", () => 1),
        new LazyFunctionStep(context, "second", () => 2),
      ];

      await mockQStashServer({
        execute: async () => {
          const throws = submitParallelSteps({
            context,
            steps,
            initialStepCount: 1,
            invokeCount: 0,
            dispatchDebug: async () => {},
          });
          expect(throws).rejects.toBeInstanceOf(WorkflowAbort);
          await throws.catch(() => {});
        },
        responseFields: { body: [{ messageId: "a" }, { messageId: "b" }], status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              headers: expect.objectContaining({
                "upstash-workflow-createdat": workflowRunCreatedAt.toString(),
              }),
            }),
            expect.objectContaining({
              headers: expect.objectContaining({
                "upstash-workflow-createdat": workflowRunCreatedAt.toString(),
              }),
            }),
          ],
        },
      });
    });
  });

  describe("trigger", () => {
    test("should send the creation time of the run when it is known", async () => {
      // e.g. the second phase of the two phase trigger for unknown SDKs,
      // where QStash has already created the run
      const context = getContext(workflowRunCreatedAt);

      await mockQStashServer({
        execute: async () => {
          const result = await triggerFirstInvocation({ workflowContext: context });
          expect(result.isOk()).toBeTrue();
        },
        responseFields: { body: [{ messageId: "msgId" }], status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              headers: expect.objectContaining({
                "upstash-workflow-createdat": workflowRunCreatedAt.toString(),
              }),
            }),
          ],
        },
      });
    });

    test("should send the trigger time when the run doesn't exist yet", async () => {
      const context = getContext(0);
      const triggerTime = 1_790_000_000_999;
      const dateNow = spyOn(Date, "now").mockReturnValue(triggerTime);

      try {
        await mockQStashServer({
          execute: async () => {
            const result = await triggerFirstInvocation({ workflowContext: context });
            expect(result.isOk()).toBeTrue();
          },
          responseFields: { body: [{ messageId: "msgId" }], status: 200 },
          receivesRequest: {
            method: "POST",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
            token,
            body: [
              expect.objectContaining({
                headers: expect.objectContaining({
                  "upstash-workflow-createdat": triggerTime.toString(),
                }),
              }),
            ],
          },
        });
      } finally {
        dateNow.mockRestore();
      }
    });
  });

  describe("delete", () => {
    test("should send the creation time so that only the same run is deleted", async () => {
      const context = getContext(workflowRunCreatedAt);

      await mockQStashServer({
        execute: async () => {
          await triggerWorkflowDelete(context, "result");
        },
        responseFields: { body: "", status: 200 },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${context.workflowRunId}?cancel=false`,
          token,
          body: "result",
          headers: { [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString() },
        },
      });
    });

    test("should send the creation time when cancelling", async () => {
      const context = getContext(workflowRunCreatedAt);

      await mockQStashServer({
        execute: async () => {
          await triggerWorkflowDelete(context, undefined, true);
        },
        responseFields: { body: "", status: 200 },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${context.workflowRunId}?cancel=true`,
          token,
          headers: { [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString() },
        },
      });
    });

    test("should not send the header when the creation time is not known", async () => {
      const context = getContext(0);

      await mockQStashServer({
        execute: async () => {
          await triggerWorkflowDelete(context, "result");
        },
        responseFields: { body: "", status: 200 },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${context.workflowRunId}?cancel=false`,
          token,
          body: "result",
          headers: { [WORKFLOW_CREATED_AT_HEADER]: null },
        },
      });
    });
  });

  test("should send the creation time with a third party call result", async () => {
    const workflowRunId = `wfr_${nanoid()}`;
    const request = new Request(WORKFLOW_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ status: 200, body: btoa("call-result") }),
      headers: new Headers({
        "Upstash-Workflow-Callback": "true",
        "Upstash-Workflow-StepId": "2",
        "Upstash-Workflow-StepName": "call",
        "Upstash-Workflow-StepType": "Call",
        "Upstash-Workflow-Concurrent": "1",
        "Upstash-Workflow-ContentType": "application/json",
        [WORKFLOW_ID_HEADER]: workflowRunId,
        [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString(),
      }),
    });

    await mockQStashServer({
      execute: async () => {
        const result = await handleThirdPartyCallResult({
          request,
          requestPayload: await request.text(),
          client: new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token }),
          workflowUrl: WORKFLOW_ENDPOINT,
        });
        expect(result.isOk()).toBeTrue();
      },
      responseFields: { body: { messageId: "msgId" }, status: 200 },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/publish/${WORKFLOW_ENDPOINT}`,
        token,
        body: expect.objectContaining({ stepName: "call" }),
        headers: { [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString() },
      },
    });
  });

  describe("serve", () => {
    const qstashClient = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token,
      enableTelemetry: false,
    });
    const { handler } = serve(
      async (context) => {
        await context.run("step", () => "result");
      },
      { qstashClient, receiver: undefined }
    );

    test("should pass the creation time of the incoming request to the next step", async () => {
      const workflowRunId = `wfr_${nanoid()}`;
      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, "initial-payload", [], {
        [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString(),
      });

      await mockQStashServer({
        execute: async () => {
          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: [{ messageId: "msgId" }], status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              headers: expect.objectContaining({
                "upstash-workflow-createdat": workflowRunCreatedAt.toString(),
                "upstash-workflow-runid": workflowRunId,
              }),
            }),
          ],
        },
      });
    });

    test("should give a first invocation the trigger time and send it with the trigger", async () => {
      // a first invocation which doesn't come from QStash has no run yet. the route function
      // (run until the first step for authorization) sees the same value that the trigger sends.
      const triggerTime = 1_790_000_000_555;
      const dateNow = spyOn(Date, "now").mockReturnValue(triggerTime);
      let seenCreatedAt: number | undefined;
      const { handler: firstInvocationHandler } = serve(
        async (context) => {
          seenCreatedAt = context.workflowRunCreatedAt;
          await context.run("step", () => "result");
        },
        { qstashClient, receiver: undefined }
      );

      try {
        await mockQStashServer({
          execute: async () => {
            const response = await firstInvocationHandler(
              new Request(WORKFLOW_ENDPOINT, { method: "POST", body: "initial-payload" })
            );
            expect(response.status).toBe(200);
          },
          responseFields: { body: [{ messageId: "msgId" }], status: 200 },
          receivesRequest: {
            method: "POST",
            url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
            token,
            body: [
              expect.objectContaining({
                headers: expect.objectContaining({
                  "upstash-workflow-createdat": triggerTime.toString(),
                  "upstash-workflow-init": "true",
                }),
              }),
            ],
          },
        });
      } finally {
        dateNow.mockRestore();
      }
      expect(seenCreatedAt).toBe(triggerTime);
    });

    test("should not make up a creation time for a request of an existing run", async () => {
      // without the header (e.g. an older QStash), a value made up per request would differ
      // between the retries of a step and break their deduplication, so nothing is sent.
      let seenCreatedAt: number | undefined;
      const { handler: noHeaderHandler } = serve(
        async (context) => {
          seenCreatedAt = context.workflowRunCreatedAt;
          await context.run("step", () => "result");
        },
        { qstashClient, receiver: undefined }
      );
      const request = getRequest(WORKFLOW_ENDPOINT, `wfr_${nanoid()}`, "initial-payload", []);

      await mockQStashServer({
        execute: async () => {
          const response = await noHeaderHandler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: [{ messageId: "msgId" }], status: 200 },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            expect.objectContaining({
              headers: expect.not.objectContaining({
                "upstash-workflow-createdat": expect.anything(),
              }),
            }),
          ],
        },
      });
      expect(seenCreatedAt).toBe(0);
    });

    test("should delete only the run it belongs to when the workflow finishes", async () => {
      const workflowRunId = `wfr_${nanoid()}`;
      const request = getRequest(
        WORKFLOW_ENDPOINT,
        workflowRunId,
        "initial-payload",
        [{ stepId: 1, stepName: "step", stepType: "Run", out: '"result"', concurrent: 1 }],
        { [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString() }
      );

      await mockQStashServer({
        execute: async () => {
          const response = await handler(request);
          expect(response.status).toBe(200);
        },
        responseFields: { body: "", status: 200 },
        receivesRequest: {
          method: "DELETE",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}?cancel=false`,
          token,
          headers: { [WORKFLOW_CREATED_AT_HEADER]: workflowRunCreatedAt.toString() },
        },
      });
    });
  });
});
