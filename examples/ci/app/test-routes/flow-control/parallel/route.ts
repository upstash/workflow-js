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
 * Six steps run in parallel, in two groups of three. Each group shares a
 * flow control key of `parallelism: 1` and a counter of its own, so a
 * group is held back only by its own key. If the settings reached QStash,
 * no step observes more than one worker inside its group — the run is
 * triggered with a permissive flow control which would otherwise let all
 * six run at once. If they did not, the steps of a group overlap and its
 * counter climbs past one.
 *
 * Two groups rather than one: a single key could pass by accident if the
 * steps happened to be serialized for some other reason, but two keys
 * have to hold their groups back independently.
 */

const GROUPS = ["a", "b"] as const;
const STEPS_PER_GROUP = 3;

const counterOf = (group: string) => `wf-step-flow-control-parallel-${group}-active-counter`;
const flowControlOf = (group: string) => `ci-step-flow-control-parallel-${group}`;

const stepIndices = Array.from({ length: STEPS_PER_GROUP }, (_, index) => index + 1);

export const { POST, GET } = testServe(
  serve<unknown>(
    async (context) => {
      const observed = await Promise.all(
        GROUPS.flatMap((group) =>
          stepIndices.map((index) =>
            context.run(
              `increment ${group}${index}`,
              incrementStep(perRunKey(context, counterOf(group))),
              incrementSettings(perRunKey(context, flowControlOf(group)))
            )
          )
        )
      );

      const withinLimit =
        observed.length === GROUPS.length * STEPS_PER_GROUP &&
        observed.every((active) => active <= STEP_PARALLELISM);
      expect(withinLimit, true);

      await saveResult(context, `parallel-flow-control-${withinLimit ? "ok" : "violated"}`);
    },
    { baseUrl: BASE_URL }
  ),
  {
    // the settings ride on the plan steps, so no step config request is
    // needed for any of the six:
    //
    //   the request which reaches the parallel group     = 1
    //   one delivery per plan step                       = 6
    //   one delivery per result, the last of which
    //     replays the run to the end                     = 6
    expectedCallCount: 13,
    expectedResult: "parallel-flow-control-ok",
    payload: undefined,
    triggerConfig: {
      retries: 0,
      // permissive trigger-level flow control: the step-level settings of
      // the six steps must override it
      flowControl: { key: "ci-trigger-flow-control-parallel", parallelism: 5 },
    },
  }
);
