import { test, describe } from "bun:test"
import { TEST_ROUTES, TEST_TIMEOUT_DURATION } from "./constants";
import { initiateTest } from "./utils";

describe("workflow integration tests", () => {
  TEST_ROUTES.forEach(testConfig => {
    test(
      testConfig.route,
      async () => {
        await initiateTest(testConfig.route)
      },
      {
        timeout: TEST_TIMEOUT_DURATION
      }
    )
  });
})