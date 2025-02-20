/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, expect, spyOn, test } from "bun:test";
import { getPayload, handleFailure, parseRequest, validateRequest } from "./workflow-parser";
import {
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "./constants";
import { nanoid } from "./utils";
import type { RawStep, Step, WaitStepResponse, WorkflowServeOptions } from "./types";
import {
  getRequest,
  MOCK_QSTASH_SERVER_URL,
  mockQStashServer,
  WORKFLOW_ENDPOINT,
} from "./test-utils";
import { formatWorkflowError, WorkflowError } from "./error";
import { Client } from "@upstash/qstash";
import { processOptions } from "./serve/options";
import { FinishState } from "./integration.test";
import { WorkflowContext } from "./context";
import { z } from "zod";
import { serve } from "../platforms/nextjs";

describe("Workflow Parser", () => {
  describe("validateRequest", () => {
    test("should accept first invocation", () => {
      const request = new Request(WORKFLOW_ENDPOINT, {
        headers: undefined,
      });

      const { isFirstInvocation, workflowRunId } = validateRequest(request);

      expect(isFirstInvocation).toBeTrue();
      expect(workflowRunId.slice(0, 4)).toBe("wfr_");
      expect(workflowRunId.length).toBeGreaterThan(2);
    });

    test("should ignore passed workflow header if first invocation", () => {
      const requestWorkflowRunId = "wfr-some-id";
      const request = new Request(WORKFLOW_ENDPOINT, {
        headers: {
          [WORKFLOW_ID_HEADER]: requestWorkflowRunId,
        },
      });

      const { isFirstInvocation, workflowRunId } = validateRequest(request);

      expect(isFirstInvocation).toBeTrue();
      // worklfow id in the request should be ignored
      expect(workflowRunId !== requestWorkflowRunId).toBeTrue();
    });

    test("should throw when protocol header is given without workflow id header", () => {
      const request = new Request(WORKFLOW_ENDPOINT, {
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        },
      });

      const throws = () => validateRequest(request);
      expect(throws).toThrow(new WorkflowError("Couldn't get workflow id from header"));
    });

    test("should throw when protocol version is incompatible", () => {
      const requestProtocol = "wrong-protocol";
      const request = new Request(WORKFLOW_ENDPOINT, {
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: requestProtocol,
        },
      });

      const throws = () => validateRequest(request);
      expect(throws).toThrow(
        new WorkflowError(
          `Incompatible workflow sdk protocol version.` +
            ` Expected ${WORKFLOW_PROTOCOL_VERSION}, got ${requestProtocol} from the request.`
        )
      );
    });

    test("should accept when called correctly", () => {
      const requestWorkflowRunId = `wfr${nanoid()}`;
      const request = new Request(WORKFLOW_ENDPOINT, {
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          [WORKFLOW_ID_HEADER]: requestWorkflowRunId,
        },
      });
      const { isFirstInvocation, workflowRunId } = validateRequest(request);

      expect(isFirstInvocation).toBeFalse();
      expect(workflowRunId).toBe(requestWorkflowRunId);
    });
  });

  describe("parseRequest", () => {
    const token = nanoid();
    const workflowRunId = nanoid();
    const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

    test("should handle first invocation", async () => {
      const payload = { initial: "payload" };
      const rawPayload = JSON.stringify(payload);
      const request = new Request(WORKFLOW_ENDPOINT, {
        body: rawPayload,
      });

      const finised = new FinishState();
      const requestPayload = (await getPayload(request)) ?? "";
      await mockQStashServer({
        execute: async () => {
          const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
            requestPayload,
            true,
            workflowRunId,
            qstashClient.http
          );

          // payload isn't parsed
          expect(typeof rawInitialPayload).toBe("string");
          expect(rawInitialPayload).toBe(rawPayload);
          // steps are empty:
          expect(steps).toEqual([]);
          expect(isLastDuplicate).toBeFalse();
          finised.finish();
        },
        // shouldn't call get steps
        receivesRequest: false,
        responseFields: {
          body: {},
          status: 200,
        },
      });
      finised.check();
    });

    test("should fetch steps when not first invocation and body is missing", async () => {
      const payload = "my-payload";
      const request = new Request(WORKFLOW_ENDPOINT);

      const requestPayload = (await getPayload(request)) ?? "";
      const finised = new FinishState();

      const responseBody: RawStep[] = [
        {
          messageId: "msg-id",
          body: btoa(JSON.stringify(payload)),
          callType: "step",
        },
      ];
      await mockQStashServer({
        execute: async () => {
          const result = await parseRequest(
            requestPayload,
            false,
            workflowRunId,
            qstashClient.http
          );
          if (result.workflowRunEnded) {
            throw new Error("failed test");
          }
          expect(result.rawInitialPayload).toBe(JSON.stringify(payload));
          expect(result.steps.length).toBe(1);
          expect(result.steps[0].out).toBe(JSON.stringify(payload));
          finised.finish();
        },
        // should call get steps
        receivesRequest: {
          headers: {},
          method: "GET",
          token,
          url: `${MOCK_QSTASH_SERVER_URL}/v2/workflows/runs/${workflowRunId}`,
        },
        responseFields: {
          body: responseBody,
          status: 200,
        },
      });

      finised.check();
    });

    test("should return steps and initial payload correctly", async () => {
      const requestInitialPayload = { initial: "payload" };
      const resultSteps: Step[] = [
        {
          stepId: 1,
          stepName: "first step",
          stepType: "Run",
          out: "first result",
          concurrent: 1,
        },
        {
          stepId: 2,
          stepName: "second step",
          stepType: "Run",
          out: "second result",
          concurrent: 1,
        },
      ];

      const request = getRequest(WORKFLOW_ENDPOINT, "wfr-id", requestInitialPayload, resultSteps);

      const requestPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest(
        requestPayload,
        false,
        workflowRunId,
        qstashClient.http
      );
      if (workflowRunEnded) {
        throw new Error("failed test");
      }

      // payload is not parsed
      expect(typeof rawInitialPayload).toEqual("string");
      expect(rawInitialPayload).toEqual(JSON.stringify(requestInitialPayload));
      expect(isLastDuplicate).toBeFalse();

      // steps
      expect(typeof steps).toBe("object");
      const expectedSteps: Step[] = [
        {
          stepId: 0,
          stepName: "init",
          stepType: "Initial",
          out: rawInitialPayload,
          concurrent: 1,
        },
        ...resultSteps,
      ];
      expect(steps).toEqual(expectedSteps);

      // first step body (which is initial payload) is also string,
      // it's not parsed:
      expect(typeof steps[0].out).toBe("string");
    });

    test("should filter out toCallback and fromCallback", async () => {
      const reqiestInitialPayload = "initial payload";
      const remainingStepId = 3;

      const getEncodedStep: (stepId: number) => string = (stepId) => {
        return btoa(
          JSON.stringify({
            stepId,
            stepName: "step",
            stepType: "Call",
            out: "result",
            concurrent: 1,
            targetStep: 1,
          })
        );
      };
      const payload = [
        {
          messageId: "msgId",
          body: btoa(reqiestInitialPayload),
          callType: "step",
        },
        {
          messageId: "msgId",
          body: getEncodedStep(1),
          callType: "toCallback",
        },
        {
          messageId: "msgId",
          body: getEncodedStep(2),
          callType: "fromCallback",
        },
        {
          messageId: "msgId",
          body: getEncodedStep(remainingStepId),
          callType: "step",
        },
      ];

      const request = new Request(WORKFLOW_ENDPOINT, {
        body: JSON.stringify(payload),
      });

      const requestPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest(
        requestPayload,
        false,
        workflowRunId,
        qstashClient.http
      );
      if (workflowRunEnded) {
        throw new Error("failed test");
      }

      expect(rawInitialPayload).toBe(reqiestInitialPayload);

      expect(steps.length).toBe(2);
      expect(steps[0].stepId).toBe(0);
      expect(steps[1].stepId).toBe(remainingStepId);
      expect(isLastDuplicate).toBeFalse();
    });

    test("should overwrite the out field of wait step", async () => {
      const eventData = "notify-data";
      const timeoutStep: Step = {
        stepId: 1,
        stepName: "wait-step-name-1",
        stepType: "Wait",
        out: undefined,
        waitTimeout: true,
        waitEventId: "wait-event-1",
        concurrent: 1,
        timeout: "1s",
      };
      const notifyStep: Step = {
        stepId: 2,
        stepName: "wait-step-name-2",
        stepType: "Wait",
        out: btoa(eventData),
        waitTimeout: false,
        waitEventId: "wait-event-2",
        concurrent: 1,
        timeout: "2s",
      };

      const payload: RawStep[] = [
        {
          messageId: "msgId",
          body: btoa("initial"),
          callType: "step",
        },
        {
          messageId: "msgId",
          body: btoa(JSON.stringify(timeoutStep)),
          callType: "step",
        },
        {
          messageId: "msgId",
          body: btoa(JSON.stringify(notifyStep)),
          callType: "step",
        },
      ];

      const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest(
        JSON.stringify(payload),
        false,
        workflowRunId,
        qstashClient.http
      );

      if (workflowRunEnded) {
        throw new Error("failed test");
      }

      expect(rawInitialPayload).toBe("initial");

      expect(steps[0].stepType).toBe("Initial");
      expect(steps[1].stepType).toBe("Wait");
      expect(steps[2].stepType).toBe("Wait");

      const timeoutResponse: WaitStepResponse = {
        eventData: undefined,
        timeout: true,
      };
      expect(steps[1].out).toEqual(timeoutResponse);

      const notifyResponse: WaitStepResponse = {
        eventData,
        timeout: false,
      };
      expect(steps[2].out).toEqual(notifyResponse);
    });
  });

  describe("parseRequest with duplicates", () => {
    const token = nanoid();
    const workflowRunId = nanoid();
    const qstashClient = new Client({ baseUrl: MOCK_QSTASH_SERVER_URL, token });

    const requestPayload = "myPayload";
    const initStep: Step = {
      stepId: 0,
      stepName: "init",
      stepType: "Initial",
      out: requestPayload,
      concurrent: 1,
    };

    test("should ignore extra init steps", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 0, stepName: "init", stepType: "Initial", out: "duplicate-payload", concurrent: 1 },
        { stepId: 1, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeFalse();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
      ])
    });

    test("target step duplicated at the end", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 }, // duplicate
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeTrue();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
      ])
    });

    test("target step duplicated in the middle", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 }, // duplicate
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeFalse();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: "10", concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
      ])
    });

    test("concurrent step result duplicated", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: "20", concurrent: 2 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: "20", concurrent: 2 }, // duplicate
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeTrue();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: 20, concurrent: 2 },
      ])
    });

    test("concurrent step result duplicated with two results", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: '"20"', concurrent: 2 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: '"20"', concurrent: 2 }, // duplicate
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeTrue();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: false, concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: true, concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: "10", concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: "20", concurrent: 2 },
      ])
    });

    test("result step duplicate", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 }, // duplicate
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeTrue();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
      ])
    });

    test("duplicate results in the middle", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 }, // duplicate
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeFalse();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
      ])
    });

    test("all duplicated", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: '"20"', concurrent: 2 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: '"20"', concurrent: 2 },
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeTrue();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: "10", concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: "20", concurrent: 2 },
      ])
    });

    test("all duplicated except last", async () => {
      // prettier-ignore
      const requestSteps: Step[] = [
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: '"false"', concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: '"true"', concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: '"10"', concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: '"20"', concurrent: 2 },
      ]

      const request = getRequest(WORKFLOW_ENDPOINT, workflowRunId, requestPayload, requestSteps);

      const requestFromPayload = (await getPayload(request)) ?? "";
      const { rawInitialPayload, steps, isLastDuplicate } = await parseRequest(
        requestFromPayload,
        false,
        workflowRunId,
        qstashClient.http
      );

      expect(rawInitialPayload).toBe(requestPayload);
      expect(isLastDuplicate).toBeFalse();

      // prettier-ignore
      expect(steps).toEqual([
        initStep,
        { stepId: 1, stepName: "chargeStep", stepType: "Run", out: "false", concurrent: 1 },
        { stepId: 2, stepName: "retrySleep", stepType: "SleepFor", sleepFor: 1_000_000, concurrent: 1 },
        { stepId: 3, stepName: "chargeStep", stepType: "Run", out: "true", concurrent: 1 },
        { stepId: 0, stepName: "successStep1", stepType: "Run", concurrent: 2, targetStep: 4 },
        { stepId: 4, stepName: "successStep1", stepType: "Run", out: "10", concurrent: 2 },
        { stepId: 0, stepName: "successStep2", stepType: "Run", concurrent: 2, targetStep: 5 },
        { stepId: 5, stepName: "successStep2", stepType: "Run", out: "20", concurrent: 2 },
      ])
    });
  });

  describe("handleFailure", () => {
    const client = new Client({
      baseUrl: process.env.MOCK_QSTASH_URL,
      token: process.env.MOCK_QSTASH_TOKEN ?? "",
    });
    const { initialPayloadParser } = processOptions();

    const failMessage = `my-custom-error-${nanoid()}`;
    const authorization = `Bearer ${nanoid()}`;
    const initialPayload = { hello: "world" };
    const body = {
      status: 201,
      header: { myHeader: "value" },
      body: btoa(JSON.stringify(formatWorkflowError(new WorkflowError(failMessage)))),
      url: WORKFLOW_ENDPOINT,
      sourceHeader: {
        [`Upstash-Failure-Callback-Forward-Authorization`]: authorization,
      },
      sourceBody: btoa(
        JSON.stringify([
          {
            callType: "step",
            messageId: "msg-id",
            body: btoa(JSON.stringify(initialPayload)),
          } as RawStep,
        ])
      ),
    };
    test("should return not-failure-callback when the header is not set", async () => {
      const request = new Request(WORKFLOW_ENDPOINT);
      const failureFunction: WorkflowServeOptions["failureFunction"] = async ({
        context,
        failStatus,
        failResponse,
      }) => {
        return;
      };

      let called = false;
      const routeFunction = async (context: WorkflowContext) => {
        called = true;
        await context.sleep("sleeping", 1);
      };

      // no failureFunction
      const result1 = await handleFailure(
        request,
        "",
        client,
        initialPayloadParser,
        routeFunction,
        undefined,
        {},
        3,
        undefined
      );
      expect(result1.isOk()).toBeTrue();
      expect(result1.isOk() && result1.value === "not-failure-callback").toBeTrue();

      // with failureFunction
      const result2 = await handleFailure(
        request,
        "",
        client,
        initialPayloadParser,
        routeFunction,
        failureFunction,
        {},
        0,
        undefined
      );
      expect(result2.isOk()).toBeTrue();
      expect(result2.isOk() && result2.value === "not-failure-callback").toBeTrue();
      expect(called).toBeFalse(); // didn't call as the request is not a failure request
    });

    const failureRequest = new Request(WORKFLOW_ENDPOINT, {
      headers: {
        [WORKFLOW_FAILURE_HEADER]: "true",
        authorization: authorization,
      },
    });

    test("should throw WorkflowError if header is set but function is not passed", async () => {
      let called = false;
      const routeFunction = async (context: WorkflowContext) => {
        called = true;
        await context.sleep("sleeping", 1);
      };

      const result = await handleFailure(
        failureRequest,
        "",
        client,
        initialPayloadParser,
        routeFunction,
        undefined,
        {},
        0,
        undefined
      );
      expect(result.isErr()).toBeTrue();
      expect(result.isErr() && result.error.name).toBe(WorkflowError.name);
      expect(result.isErr() && result.error.message).toBe(
        "Workflow endpoint is called to handle a failure," +
          " but a failureFunction is not provided in serve options." +
          " Either provide a failureUrl or a failureFunction."
      );
      expect(called).toBeFalse(); // not called since we threw before auth check
    });

    test("should return error when the failure function throws an error", async () => {
      let called = false;
      const routeFunction = async (context: WorkflowContext) => {
        called = true;
        await context.sleep("sleeping", 1);
      };
      const failureFunction: WorkflowServeOptions["failureFunction"] = async () => {
        throw new Error("my-error");
      };

      const result = await handleFailure(
        failureRequest,
        JSON.stringify(body),
        client,
        initialPayloadParser,
        routeFunction,
        failureFunction,
        {},
        3,
        undefined
      );
      expect(result.isErr()).toBeTrue();
      expect(result.isErr() && result.error.message).toBe("my-error");
      expect(called).toBeTrue();
    });

    test("should return is-failure-callback when failure code runs succesfully", async () => {
      let called = false;
      const routeFunction = async (context: WorkflowContext) => {
        called = true;
        await context.sleep("sleeping", 1);
      };
      const failureFunction: WorkflowServeOptions["failureFunction"] = async ({
        context,
        failStatus,
        failResponse,
      }) => {
        expect(failStatus).toBe(201);
        expect(failResponse).toBe(failMessage);
        expect(context.headers.get("authorization")).toBe(authorization);
        return;
      };

      const result = await handleFailure(
        failureRequest,
        JSON.stringify(body),
        client,
        initialPayloadParser,
        routeFunction,
        failureFunction,
        {},
        0,
        undefined
      );
      console.log(result);

      expect(result.isOk()).toBeTrue();
      expect(result.isOk() && result.value).toBe("is-failure-callback");
      expect(called).toBeTrue();
    });

    test("should throw if there are no steps in the route function or when the function returns", async () => {
      let called = false;
      const routeFunctionWithoutSteps = async (context: WorkflowContext) => {
        called = true;
      };
      const failureFunction = async () => {};

      const result = await handleFailure(
        failureRequest,
        JSON.stringify(body),
        client,
        initialPayloadParser,
        routeFunctionWithoutSteps,
        failureFunction,
        {},
        3,
        undefined
      );

      expect(result.isErr());
      // @ts-expect-error error will be set bc of the check above
      const error = result.error as Error;
      expect(error.name).toBe("WorkflowError");
      expect(error.message).toBe("Not authorized to run the failure function.");
      expect(called).toBeTrue();
    });
  });
});

describe("schema validation in serve", () => {
  const testServe = async (
    options: Parameters<typeof serve>[1],
    payload: unknown,
    expectedStatus: number,
    expectedError?: string
  ) => {
    const { POST } = serve(async () => {}, {
      ...options,
      env: {
        QSTASH_TOKEN: process.env.QSTASH_TOKEN,
      },
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(expectedStatus);

    if (expectedError) {
      const { error, message } = (await response.json()) as { error: string; message: string };
      expect(error).toBe("ZodError");
      expect(message).toContain(expectedError);
    } else {
      const { message, workflowRunId } = (await response.json()) as {
        message: string;
        workflowRunId: string;
      };
      expect(workflowRunId).toBe("no-workflow-id");
      expect(message).toContain("Failed to authenticate Workflow request");
    }
  };

  const schema = z.object({ field: z.string() });
  const parser = (payload: string) => JSON.parse(payload);

  const validPayload = { field: "test" };
  const invalidPayload = { field: 123 };

  test("schema - valid payload", () => testServe({ schema }, validPayload, 400));

  test("schema - invalid payload", () =>
    testServe({ schema }, invalidPayload, 500, "Expected string, received number"));

  test("parser - valid payload", () =>
    testServe({ initialPayloadParser: parser }, validPayload, 400));

  test("parser - invalid payload", () =>
    testServe({ initialPayloadParser: parser }, invalidPayload, 400));

  test("schema + parser - valid payload", () =>
    // @ts-expect-error Schema and initialPayloadParser are mutually exclusive
    testServe({ schema, initialPayloadParser: parser }, validPayload, 400));

  test("schema + parser - invalid payload", () =>
    // @ts-expect-error Schema and initialPayloadParser are mutually
    testServe({ schema, initialPayloadParser: parser }, invalidPayload, 400));

  test("no validation - valid payload", () => testServe({}, validPayload, 400));

  test("no validation - invalid payload", () => testServe({}, invalidPayload, 400));
});
