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
      testConfig.timeout ?? TEST_TIMEOUT_DURATION
    )
  });
})