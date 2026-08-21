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
  // the routes differ in how the ungated delivery which reaches the
  // gated step is produced.
  const flowControlRoutes = [
    // the gated step is the first step of the run
    "flow-control/first-step",
    // the gated step comes after a context.run step
    "flow-control/step",
    // the gated step comes after a context.call step
    "flow-control/call",
    // the gated step comes after a context.invoke step
    "flow-control/invoke/workflows/invokerParent",
  ]

  // the settings the SDK publishes must come back in a form it
  // recognizes, or every delivery looks mismatched. Single run: this
  // checks normalization and the request count, not concurrency.
  test(
    "flow-control/normalization",
    async () => {
      await initiateTest({ route: "flow-control/normalization" })
    },
    TEST_TIMEOUT_DURATION
  )

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