import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { saveResult } from "app/ci/upstash/redis";
import { expect, testServe } from "app/ci/utils";
import { incrementSettings, incrementStep, perRunKey, STEP_PARALLELISM } from "../shared";

/**
 * the steps which carry settings are in a parallel group.
 *
 * A parallel step never reaches the SDK on a delivery of its own making:
 * QStash publishes one message per plan step, so the settings have to
 * ride on the plan steps rather than on a step config request. This
 * route is what proves they do.
 *
 * Four steps run in parallel, in two pairs. Each pair shares a flow
 * control key of `parallelism: 1` and a counter of its own, so a pair is
 * held back only by its own key. If the settings reached QStash, no step
 * observes more than one worker inside its pair — the run is triggered
 * with a permissive flow control which would otherwise let all four run
 * at once. If they did not, both steps of a pair overlap and the pair's
 * counter reaches two.
 *
 * Two pairs rather than one: a single key could pass by accident if the
 * steps happened to be serialized for some other reason, but two keys
 * have to hold their pairs back independently.
 */

const PAIRS = ["a", "b"] as const;

const counterOf = (pair: string) => `wf-step-flow-control-parallel-${pair}-active-counter`;
const flowControlOf = (pair: string) => `ci-step-flow-control-parallel-${pair}`;

export const { POST, GET } = testServe(
  serve<unknown>(
    async (context) => {
      const observed = await Promise.all(
        PAIRS.flatMap((pair) =>
          [1, 2].map((index) =>
            context.run(
              `increment ${pair}${index}`,
              incrementStep(perRunKey(context, counterOf(pair))),
              incrementSettings(perRunKey(context, flowControlOf(pair)))
            )
          )
        )
      );

      const withinLimit =
        observed.length === PAIRS.length * 2 &&
        observed.every((active) => active <= STEP_PARALLELISM);
      expect(withinLimit, true);

      await saveResult(context, `parallel-flow-control-${withinLimit ? "ok" : "violated"}`);
    },
    { baseUrl: BASE_URL }
  ),
  {
    // the settings ride on the plan steps, so no step config request is
    // needed for any of the four:
    //
    //   the request which reaches the parallel group     = 1
    //   one delivery per plan step                       = 4
    //   one delivery per result, the last of which
    //     replays the run to the end                     = 4
    expectedCallCount: 9,
    expectedResult: "parallel-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      // permissive trigger-level flow control: the step-level settings of
      // the four steps must override it
      flowControl: { key: "ci-trigger-flow-control-parallel", parallelism: 5 },
    },
  }
);
