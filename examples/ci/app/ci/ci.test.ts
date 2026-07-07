import { test, describe } from "vitest"
import { TEST_ROUTES, TEST_TIMEOUT_DURATION } from "./constants";
import { initiateTest } from "./utils";

describe("workflow integration tests", () => {
  TEST_ROUTES.forEach(testConfig => {
    test(
      testConfig.route,
      async () => {
        await initiateTest(testConfig)
      },
      TEST_TIMEOUT_DURATION
    )
  });

  // the flow-control tests trigger concurrent runs of the same workflow:
  // the step-level flow control of the `increment` step (parallelism 1)
  // must gate the runs even though the trigger-level flow control is
  // permissive. Each run asserts that it never observed more concurrency
  // than the step-level parallelism allows.
  const flowControlRoutes = [
    // step after context.run (settings attached with deferred submission)
    "flow-control/step",
    // step after context.call (settings discovered when the call result arrives)
    "flow-control/call",
    // step after context.invoke (settings discovered when the invoke result arrives)
    "flow-control/invoke/workflows/invokerParent",
  ]

  flowControlRoutes.forEach(route => {
    test(
      `${route} (concurrent runs)`,
      async () => {
        await Promise.all([
          initiateTest({ route }),
          initiateTest({ route }),
          initiateTest({ route }),
        ])
      },
      TEST_TIMEOUT_DURATION
    )
  })
})