import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import { QstashError } from "@upstash/qstash";
import { formatWorkflowError } from "../error";
import { MiddlewareManager } from "./manager";
import { WorkflowMiddleware } from "./middleware";
import { onErrorWithConsole } from "./default-callbacks";

const missingCredentials = (alreadyLogged: boolean) =>
  Object.assign(new QstashError("Set QSTASH_TOKEN or use QSTASH_DEV=true.", 401), {
    code: "QSTASH_MISSING_CREDENTIALS",
    alreadyLogged,
  });

describe("missing credential diagnostics", () => {
  let errors: Mock<typeof console.error>;
  beforeEach(() => {
    errors = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  test("suppresses repeated default logs while delivering errors to custom middleware", async () => {
    const received: Error[] = [];
    const middleware = new WorkflowMiddleware({
      name: "error-observer",
      init: () => ({
        onError: ({ error }) => {
          received.push(error);
        },
      }),
    });
    const error = missingCredentials(true);
    // serve creates a new manager per request, so deduplication must survive that.
    for (let attempt = 0; attempt < 2; attempt++) {
      await new MiddlewareManager([middleware]).dispatchDebug("onError", { error });
    }
    expect(received).toEqual([error, error]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("still logs an unreported setup error", async () => {
    await onErrorWithConsole({ error: missingCredentials(false) });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toContain("QSTASH_DEV=true");
  });

  test("returns setup guidance once in the response without a stack", () => {
    const error = missingCredentials(true);
    expect(formatWorkflowError(error)).toEqual({ error: "QstashError", message: error.message });
    expect(error.stack).toBeDefined();
  });

  test.each([
    new QstashError("Unauthorized", 401),
    new Error("Set QSTASH_TOKEN or use QSTASH_DEV=true."),
  ])("preserves logging and stacks without the setup-error marker", async (error) => {
    await onErrorWithConsole({ error });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(formatWorkflowError(error).stack).toBe(error.stack);
  });
});
