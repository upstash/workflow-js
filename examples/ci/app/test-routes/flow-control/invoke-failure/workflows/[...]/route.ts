import { Client, WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import { ciHeaders, perRunKey } from "../../../shared";

/**
 * the workflow throws right after a step which carries settings.
 *
 * A step which can produce its result on the spot does not end the
 * request that runs it: the SDK holds the result and lets the function
 * carry on, so that whatever comes next is already known when the result
 * is submitted. Throwing right there is the case where nothing comes
 * next. The held result still has to reach QStash — losing it would make
 * the step run twice — and the error still has to fail the run.
 *
 * The worker is invoked rather than triggered so the failure is observed
 * from two sides at once: the invoke reports it, and the worker's own log
 * shows the step succeeded before the run failed. `retries: 0` on both
 * sides keeps the failure to a single attempt.
 */

const client = new Client({
  baseUrl: process.env.QSTASH_URL!,
  token: process.env.QSTASH_TOKEN!,
});

const STEP_NAME = "step 1";
const STEP_RESULT = "step-1-result";
const WORKER_ERROR = "worker failed on purpose";
const FLOW_CONTROL = "ci-step-flow-control-invoke-failure";

const worker = createWorkflow(async (context: WorkflowContext<string>) => {
  const result = await context.run(STEP_NAME, () => STEP_RESULT, {
    flowControl: { key: perRunKey(context, FLOW_CONTROL), parallelism: 1 },
    retries: 0,
  });

  expect(result, STEP_RESULT);

  // the step above is still held at this point: submitting it is what
  // this route is about
  throw new WorkflowNonRetryableError(WORKER_ERROR);
});

const coordinator = createWorkflow(async (context: WorkflowContext<unknown>) => {
  // the run id has to be known before the invoke, to read the worker's log
  const workerRunId = perRunKey(context, "wf-step-flow-control-invoke-failure");

  const { isFailed } = await context.invoke("invoke worker", {
    workflow: worker,
    body: "worker-payload",
    headers: ciHeaders(context),
    workflowRunId: workerRunId,
    retries: 0,
  });

  // the invoke reports the failure rather than resolving with a body
  expect(isFailed, true);

  await context.run("check worker log", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { runs } = await client.logs({ workflowRunId: `wfr_${workerRunId}` });
      const run = runs[0];

      if (!run || run.workflowState !== "RUN_FAILED") {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      // the held step reached QStash before the error did: a step which
      // was never submitted has no log entry of its own at all
      const stepGroup = run.steps.find(
        (group) => group.type === "sequential" && group.steps[0].stepName === STEP_NAME
      );
      if (!stepGroup || stepGroup.type !== "sequential") {
        throw new WorkflowNonRetryableError(`no log entry for the step '${STEP_NAME}'`);
      }
      expect(stepGroup.steps[0].state, "STEP_SUCCESS");
      expect(stepGroup.steps[0].out as string, JSON.stringify(STEP_RESULT));

      // and what failed the run is the error the worker threw, on the
      // step after it rather than on the step which succeeded
      const failedGroup = run.steps.find(
        (group) => group.type === "next" && group.steps[0].state === "STEP_FAILED"
      );
      if (!failedGroup || failedGroup.type !== "next") {
        throw new WorkflowNonRetryableError("the worker run failed without a failed step");
      }
      const errors = failedGroup.steps[0].errors ?? [];
      const threw = errors.some(({ body }) => body.includes(WORKER_ERROR));
      if (!threw) {
        throw new WorkflowNonRetryableError(
          `the worker did not fail with its own error: ${JSON.stringify(errors)}`
        );
      }
      return;
    }
    throw new WorkflowNonRetryableError("the worker run did not fail in time");
  });

  await saveResult(context, "invoke-failure-flow-control-ok");
});

export const { POST, GET } = testServe(
  serveMany({ coordinator, worker }, { baseUrl: BASE_URL }),
  {
    // both workflows are served from this route, so both are counted:
    //
    //   coordinator: the trigger which publishes the invoke, the
    //     invoke's result, and the replay which ends the run    = 3
    //   worker: a step config request for the step with settings,
    //     the delivery which runs it and holds the result, the
    //     delivery which throws, and the one which reports it   = 4
    expectedCallCount: 7,
    expectedResult: "invoke-failure-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      flowControl: { key: "ci-trigger-flow-control-invoke-failure", parallelism: 5 },
    },
  }
);
