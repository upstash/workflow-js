import { test, describe } from "bun:test";
import { TEST_ROUTES } from "./constants";
import { initiateTest } from "./utils";
import { TestConfig } from "./types";

const BATCH_SIZE = 5
const BATCH_COUNT = Math.ceil(TEST_ROUTES.length / BATCH_SIZE)

async function runBatch(batch: TestConfig[], batchIndex: number) {
  const tasks = batch.map((testConfig, index) => async () => {
    const batchTestIndex = index + 1;
    try {
      await initiateTest(testConfig.route, testConfig.waitForSeconds);
      console.log(`Success: Test ${testConfig.route} (Batch ${batchIndex}, Test ${batchTestIndex})`);
    } catch (error_) {
      const error  = error_ as Error
      console.error(
        `Failure: Test ${testConfig.route} (Batch ${batchIndex}, Test ${batchTestIndex}) - Error: ${
          error.message || error
        }`
      );
      throw error;
    }
  });

  const results = await Promise.allSettled(tasks.map(task => task()));
  const failures = results.filter(result => result.status === "rejected");

  console.log(
    `Batch ${batchIndex}/${BATCH_COUNT}: ${results.length - failures.length}/${results.length} passed`
  );

  if (failures.length) {
    throw new Error(`batch ${batchIndex} failed.`)
  }

  return results;
}

function declareBatchTest(batch: TestConfig[], batchIndex: number) {
  const maxWaitTime = Math.max(...batch.map(config => config.waitForSeconds));
  const timeout = (maxWaitTime + 8) * 1000;

  test(
    `Batch ${batchIndex} Tests`,
    async () => {
      await runBatch(batch, batchIndex);
    },
    { timeout }
  );
}

describe("workflow integration tests", () => {

  // Sort TEST_ROUTES by 'waitForSeconds' (shortest to longest)
  const sortedRoutes = [...TEST_ROUTES].sort((a, b) => a.waitForSeconds - b.waitForSeconds);

  for (let i = 0; i < sortedRoutes.length; i += BATCH_SIZE) {
    const batch = sortedRoutes.slice(i, i + BATCH_SIZE);
    // @ts-expect-error picked TestConfig mismatch
    declareBatchTest(batch, Math.floor(i / BATCH_SIZE) + 1);
  }
});
