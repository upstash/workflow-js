import { test, describe } from "bun:test"
import { TEST_ROUTES } from "./constants";
import { initiateTest } from "./utils";

describe("workflow integration tests", () => {
  TEST_ROUTES.forEach(testConfig => {
    test(
      testConfig.route,
      async () => {
        await initiateTest(testConfig.route, testConfig.waitForSeconds)
      },
      {
        timeout: (testConfig.waitForSeconds + 10) * 1000
      }
    )
  });
})