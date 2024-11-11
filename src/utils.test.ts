import { describe, test, expect } from "bun:test";
import { getWorkflowRunId } from "./utils";

describe("getWorkflowRunId", () => {
  test("should return random with no id", () => {
    const workflowRunId = getWorkflowRunId();
    expect(workflowRunId.length).toBe(25);
    expect(workflowRunId.slice(0, 4)).toBe("wfr_");
  });

  test("should return with given id", () => {
    const workflowRunId = getWorkflowRunId("my-id");
    expect(workflowRunId.length).toBe(9);
    expect(workflowRunId).toBe("wfr_my-id");
  });
});
