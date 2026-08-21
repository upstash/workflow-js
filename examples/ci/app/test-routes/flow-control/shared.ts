import { WorkflowContext } from "@upstash/workflow";
import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants";
import { redis } from "app/ci/upstash/redis";

/**
 * shared pieces of the step-level flow control tests.
 *
 * Each route is triggered once, as a `coordinator` workflow which invokes
 * `WORKER_COUNT` workers in parallel. The workers are what the test is
 * about: each reaches an `increment` step carrying step-level flow
 * control of `parallelism: 1`, while the run itself is triggered with a
 * permissive trigger-level flow control.
 *
 * `increment` increments a counter shared by the workers, holds it, and
 * decrements it. The value a worker observes right after incrementing is
 * how many workers were inside the step at that moment. If the
 * step-level flow control is applied, no worker can ever observe more
 * than `STEP_PARALLELISM` — even though the trigger-level flow control
 * would let all of them run it at once.
 *
 * The routes differ only in what the worker does *before* `increment`,
 * which is what decides how the delivery that reaches it was produced.
 */

export const STEP_PARALLELISM = 1;
export const WORKER_COUNT = 3;

const HOLD_DURATION_MS = 3000;
const COUNTER_EXPIRY_SECS = 60;

/**
 * Forwards the CI headers to an invoked run, so its requests are counted
 * against the same test.
 *
 * @param context context of the invoking workflow
 */
export const ciHeaders = (context: WorkflowContext<unknown>) => ({
  [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
  [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
});

/**
 * Builds the body of the gated `increment` step.
 *
 * @param counterKey redis key of the counter shared by the workers
 * @returns the number of workers inside the step, including this one
 */
export const incrementStep = (counterKey: string) => async () => {
  const active = await redis.incr(counterKey);
  await redis.expire(counterKey, COUNTER_EXPIRY_SECS);
  try {
    // hold the slot: workers would overlap here if the step-level flow
    // control were not applied
    await new Promise((r) => setTimeout(r, HOLD_DURATION_MS));
    return active;
  } finally {
    await redis.decr(counterKey);
  }
};

/**
 * Step-level settings every worker attaches to its `increment` step.
 *
 * @param flowControlKey flow control key shared by the workers
 */
export const incrementSettings = (flowControlKey: string) => ({
  flowControl: { key: flowControlKey, parallelism: STEP_PARALLELISM },
  retries: 0,
});

/**
 * Whether every worker stayed within the step-level parallelism.
 *
 * @param observed values the workers observed inside `increment`
 */
export const wasGated = (observed: number[]) =>
  observed.length === WORKER_COUNT && observed.every((active) => active <= STEP_PARALLELISM);
