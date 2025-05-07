import { test, describe } from "vitest";
import { TEST_ROUTES, TEST_TIMEOUT_DURATION } from "./constants";
import { initiateTest } from "./utils";
import { config } from "dotenv";

config();

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