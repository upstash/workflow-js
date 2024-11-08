import { test } from "bun:test"
import { describe } from "node:test"
import { TEST_CONFIG } from "./config";
import { testEndpoint } from "./utils";

describe("workflow integration tests", () => {
  TEST_CONFIG.forEach(config => {
    test(config.route, async () => {
      await testEndpoint(config)
    })
  });
})