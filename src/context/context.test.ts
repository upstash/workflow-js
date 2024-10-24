/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, test, expect } from "bun:test";
import { MOCK_QSTASH_SERVER_URL, mockQStashServer, WORKFLOW_ENDPOINT } from "../test-utils";
import { WorkflowContext } from "./context";
import { Client } from "@upstash/qstash";
import { nanoid } from "../utils";
import { WorkflowAbort, WorkflowError } from "../error";
import {
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "../constants";

describe("context tests", () => {
  const token = nanoid();
  const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });
  test("should raise when there are nested steps (with run)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.run("inner step", () => {
          return "result";
        });
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner step' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with sleep)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.sleep("inner sleep", 2);
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner sleep' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with sleepUntil)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.sleepUntil("inner sleepUntil", 2);
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner sleepUntil' inside 'outer step'"
      )
    );
  });

  test("should raise when there are nested steps (with call)", () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
    });

    const throws = async () => {
      await context.run("outer step", async () => {
        await context.call("inner call", { url: "https://some-url.com" });
      });
    };
    expect(throws).toThrow(
      new WorkflowError(
        "A step can not be run inside another step. Tried to run 'inner call' inside 'outer step'"
      )
    );
  });

  test("should not raise when there are no nested steps", async () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
      retries: 2,
    });

    await mockQStashServer({
      execute: () => {
        const throws = () =>
          context.run("my-step", () => {
            return "my-result";
          });
        expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
      },
      responseFields: {
        status: 200,
        body: "msgId",
      },
      receivesRequest: {
        method: "POST",
        url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
        token,
        body: [
          {
            body: '{"stepId":1,"stepName":"my-step","stepType":"Run","out":"\\"my-result\\"","concurrent":1}',
            destination: WORKFLOW_ENDPOINT,
            headers: {
              "content-type": "application/json",
              "upstash-forward-upstash-workflow-sdk-version": "1",
              "upstash-method": "POST",
              "upstash-retries": "2",
              "upstash-workflow-init": "false",
              "upstash-workflow-runid": "wfr-id",
              "upstash-workflow-url": WORKFLOW_ENDPOINT,
            },
          },
        ],
      },
    });
  });

  describe("wait for event step", () => {
    test("should send request to wait endpoint if there is a wait for event step", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
      });

      const eventId = "my-event-id";
      await mockQStashServer({
        execute: () => {
          const throws = () => context.waitForEvent("my-step", eventId, 20);
          expect(throws).toThrowError("Aborting workflow after executing step 'my-step'.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/wait/${eventId}`,
          token,
          body: {
            step: {
              concurrent: 1,
              stepId: 1,
              stepName: "my-step",
              stepType: "Wait",
            },
            timeout: "20s",
            timeoutHeaders: {
              "Content-Type": ["application/json"],
              [`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`]: ["1"],
              "Upstash-Retries": ["3"],
              "Upstash-Workflow-CallType": ["step"],
              [WORKFLOW_INIT_HEADER]: ["false"],
              [WORKFLOW_ID_HEADER]: ["wfr-id"],
              "Upstash-Workflow-Runid": ["wfr-id"],
              [WORKFLOW_URL_HEADER]: [WORKFLOW_ENDPOINT],
            },
            timeoutUrl: WORKFLOW_ENDPOINT,
            url: WORKFLOW_ENDPOINT,
          },
        },
      });
    });

    test("should send request to batch endpoint if there is a parallel wait for event step", async () => {
      const context = new WorkflowContext({
        qstashClient,
        initialPayload: "my-payload",
        steps: [],
        url: WORKFLOW_ENDPOINT,
        headers: new Headers() as Headers,
        workflowRunId: "wfr-id",
      });

      const eventId = "my-event-id";
      await mockQStashServer({
        execute: () => {
          const throws = () =>
            Promise.all([
              context.waitForEvent("my-wait-step", eventId, 20),
              context.run("my-run-step", () => "foo"),
            ]);
          expect(throws).toThrowError("Aborting workflow after executing step 'my-wait-step'.");
        },
        responseFields: {
          status: 200,
          body: "msgId",
        },
        receivesRequest: {
          method: "POST",
          url: `${MOCK_QSTASH_SERVER_URL}/v2/batch`,
          token,
          body: [
            {
              body: '{"stepId":0,"stepName":"my-wait-step","stepType":"Wait","waitEventId":"my-event-id","timeout":"20s","concurrent":2,"targetStep":1}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-retries": "3",
                "upstash-workflow-calltype": "step",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
            {
              body: '{"stepId":0,"stepName":"my-run-step","stepType":"Run","concurrent":2,"targetStep":2}',
              destination: WORKFLOW_ENDPOINT,
              headers: {
                "content-type": "application/json",
                "upstash-forward-upstash-workflow-sdk-version": "1",
                "upstash-method": "POST",
                "upstash-retries": "3",
                "upstash-workflow-init": "false",
                "upstash-workflow-runid": "wfr-id",
                "upstash-workflow-url": WORKFLOW_ENDPOINT,
              },
            },
          ],
        },
      });
    });
  });

  test("cancel should throw abort with cleanup: true", async () => {
    const context = new WorkflowContext({
      qstashClient,
      initialPayload: "my-payload",
      steps: [],
      url: WORKFLOW_ENDPOINT,
      headers: new Headers() as Headers,
      workflowRunId: "wfr-id",
    });
    try {
      await context.cancel();
    } catch (error) {
      expect(error instanceof WorkflowAbort).toBeTrue();
      const _error = error as WorkflowAbort;
      expect(_error.stepName).toBe("cancel");
      expect(_error.name).toBe("WorkflowAbort");
      expect(_error.cancelWorkflow).toBeTrue();
      return;
    }
    throw new Error("Test error: context.cancel should have thrown abort error.");
  });
});
