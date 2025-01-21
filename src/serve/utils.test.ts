import { describe, test, expect } from "bun:test";
import { WorkflowContext } from "../context";
import { Client } from "@upstash/qstash";
import { isDisabledWorkflowContext } from "./utils";
import { DisabledWorkflowContext } from "./authorization";

describe("isDisabledWorkflowContext", () => {
  test("should return false for context", () => {
    const context = new WorkflowContext({
      qstashClient: new Client({ token: "mock" }),
      headers: new Headers({}) as Headers,
      initialPayload: "",
      steps: [],
      url: "",
      workflowRunId: "",
    });

    expect(isDisabledWorkflowContext(context)).toBeFalse();
  });

  test("should return true for disabled context", () => {
    const context = new DisabledWorkflowContext({
      qstashClient: new Client({ token: "mock" }),
      headers: new Headers({}) as Headers,
      initialPayload: "",
      steps: [],
      url: "",
      workflowRunId: "",
    });

    expect(isDisabledWorkflowContext(context)).toBeTrue();
  });
});
