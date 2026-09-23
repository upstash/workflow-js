import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import { QstashError } from "@upstash/qstash";
import { formatWorkflowError } from "../error";
import { onErrorWithConsole } from "./default-callbacks";

const missingCredentials = () =>
  Object.assign(new QstashError("Set QSTASH_TOKEN or use QSTASH_DEV=true.", 401), {
    code: "QSTASH_MISSING_CREDENTIALS",
  });

describe("missing credential diagnostics", () => {
  let errors: Mock<typeof console.error>;
  beforeEach(() => {
    errors = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  test("logs every failed request", async () => {
    const error = missingCredentials();
    for (let attempt = 0; attempt < 2; attempt++) {
      await onErrorWithConsole({ workflowRunId: "wfr_1", error });
    }
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors.mock.calls[0][0]).toContain("QSTASH_DEV=true");
  });

  test("returns setup guidance in the response without a stack", () => {
    const error = missingCredentials();
    expect(formatWorkflowError(error)).toEqual({ error: "QstashError", message: error.message });
    expect(error.stack).toBeDefined();
  });

  test.each([
    new QstashError("Unauthorized", 401),
    new Error("Set QSTASH_TOKEN or use QSTASH_DEV=true."),
  ])("preserves stacks without the setup-error marker", (error) => {
    expect(formatWorkflowError(error).stack).toBe(error.stack);
  });
});
