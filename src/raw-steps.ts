import { NO_CONCURRENCY } from "./constants";
import { RawStep, Step } from "./types";
import { decodeBase64 } from "./utils";

/**
 * Parses a request coming from QStash. First parses the string as JSON, which will result
 * in a list of objects with messageId & body fields. Body will be base64 encoded.
 *
 * Body of the first item will be the body of the first request received in the workflow API.
 * Rest are steps in Upstash Workflow Step format.
 *
 * When returning steps, we add the initial payload as initial step. This is to make it simpler
 * in the rest of the code.
 *
 * @param rawSteps list of raw steps from QStash
 * @returns initial payload and list of steps
 */
export const processRawSteps = (rawSteps: RawStep[]) => {
  const [encodedInitialPayload, ...encodedSteps] = rawSteps;

  // decode initial payload:
  const rawInitialPayload = decodeBase64(encodedInitialPayload.body);
  const initialStep: Step = {
    stepId: 0,
    stepName: "init",
    stepType: "Initial",
    out: rawInitialPayload,
    concurrent: NO_CONCURRENCY,
  };

  // only keep step entries (skips "toCallback", "fromCallback" and "discovery"):
  const stepsToDecode = encodedSteps.filter((step) => step.callType === "step");

  // decode & parse other steps:
  const otherSteps = stepsToDecode.map((rawStep) => {
    const step = JSON.parse(decodeBase64(rawStep.body)) as Step;
    return step;
  });

  // join and deduplicate steps:
  const steps: Step[] = [initialStep, ...otherSteps];
  return {
    rawInitialPayload,
    steps,
  };
};

/**
 * Our steps list can potentially have duplicates. In this case, the
 * workflow SDK should get rid of the duplicates
 *
 * There are two potentials cases:
 * 1. Two results steps with equal stepId fields.
 * 2. Two plan steps with equal targetStep fields.
 *
 * @param steps steps with possible duplicates
 * @returns deduplicated steps
 */
export const deduplicateSteps = (steps: Step[]): Step[] => {
  const targetStepIds: number[] = [];
  const stepIds: number[] = [];
  const deduplicatedSteps: Step[] = [];

  for (const step of steps) {
    if (step.stepId === 0) {
      // Step is a plan step
      if (!targetStepIds.includes(step.targetStep ?? 0)) {
        deduplicatedSteps.push(step);
        targetStepIds.push(step.targetStep ?? 0);
      }
    } else {
      // Step is a result step
      if (!stepIds.includes(step.stepId)) {
        deduplicatedSteps.push(step);
        stepIds.push(step.stepId);
      }
    }
  }

  return deduplicatedSteps;
};

/**
 * body of a hidden discovery request published by the SDK.
 *
 * @see `publishStepSettingsRedelivery`
 */
type DiscoveryRequestBody = {
  /**
   * id of the step which the redelivery is meant to execute
   */
  discoveryTargetStep: number;
};

/**
 * Collects the ids of the steps for which a step-level settings
 * redelivery was already published, by reading the hidden `discovery`
 * entries of the raw steps.
 *
 * The executor uses this to tell whether the current delivery is the
 * gated redelivery of a step: if the step it is about to execute is in
 * this set, the redelivery was already published (and this delivery is
 * it), so the step is executed instead of being redelivered again.
 *
 * Reading the ids off the steps list instead of a request header keeps
 * the decision deterministic across replays and QStash retries.
 *
 * @param rawSteps list of raw steps from QStash
 * @returns ids of the steps which have a published redelivery
 */
export const parseDiscoveryTargets = (rawSteps: RawStep[]): Set<number> => {
  const targets = new Set<number>();

  for (const rawStep of rawSteps) {
    if (rawStep.callType !== "discovery") {
      continue;
    }
    try {
      const { discoveryTargetStep } = JSON.parse(
        decodeBase64(rawStep.body)
      ) as DiscoveryRequestBody;
      if (typeof discoveryTargetStep === "number") {
        targets.add(discoveryTargetStep);
      }
    } catch {
      // a discovery entry we can't parse is ignored. Worst case the
      // redelivery is published a second time, which QStash deduplicates
      // since the request content is identical.
    }
  }

  return targets;
};
