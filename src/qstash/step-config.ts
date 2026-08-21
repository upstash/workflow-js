import type { FlowControl } from "@upstash/qstash";
import {
  FLOW_CONTROL_KEY_HEADER,
  FLOW_CONTROL_VALUE_HEADER,
  MAX_RETRIES_HEADER,
  RETRY_DELAY_HEADER,
  WORKFLOW_STEP_CONFIG_HEADER,
} from "../constants";
import type { Duration, StepSettings } from "../types";

/**
 * The configuration QStash applied to the delivery in hand.
 *
 * Reported on every delivery through the `Upstash-Flow-Control-*`,
 * `Upstash-Retries` and `Upstash-Retry-Delay` headers. For an ordinary delivery this is the configuration the run was triggered with; for a
 * step-configured delivery it is that step's own configuration, which
 * delivery is meant to execute.
 */
export type EffectiveConfig = {
  /**
   * flow control applied to this delivery, if any
   */
  flowControl?: NormalizedFlowControl;
  /**
   * retry limit of this delivery, or undefined when QStash did not
   * report one (a version which predates the header)
   */
  retries?: number;
  /**
   * retry delay expression applied to this delivery, if any
   */
  retryDelay?: string;
  /**
   * whether the message of this delivery was published with step-level
   * settings (the guard marker).
   */
  hasStepConfig: boolean;
};

/**
 * Flow control reduced to a form both sides of the protocol agree on.
 *
 * Needed because the SDK and QStash format the same values differently:
 * the SDK joins the control value with ", " and writes durations
 * (`period=1m`), QStash joins with "," and writes whole seconds
 * (`period=60`). `rate` and `ratePerSecond` are aliases on the SDK side.
 * Comparing the header strings would report a mismatch for values which
 * are in fact identical, so both sides are parsed into this shape first.
 */
export type NormalizedFlowControl = {
  key: string;
  parallelism: number;
  rate: number;
  /**
   * period in whole seconds
   */
  period: number;
};

/**
 * Defaults QStash applies to a flow control it is given, mirrored here so
 * that both sides of a comparison agree on what "unset" means.
 *
 * An unset period becomes one second rather than staying unset (see
 * `parseFlowControl` on the server), so a flow control published without
 * a period is reported back with `period=1`.
 */
const DEFAULT_PARALLELISM = 0;
const DEFAULT_RATE = 0;
const DEFAULT_PERIOD_SECONDS = 1;

const SECONDS_PER_UNIT: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Converts a duration to whole seconds.
 *
 * @param duration number of seconds, or a duration string such as "1m"
 * @returns the duration in seconds, or undefined if it can't be parsed
 */
export const durationToSeconds = (duration: number | Duration | string): number | undefined => {
  if (typeof duration === "number") {
    return Number.isFinite(duration) ? duration : undefined;
  }

  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (match) {
    return Number(match[1]) * SECONDS_PER_UNIT[match[2]];
  }

  // a bare number as a string ("60"), which is how QStash reports periods
  const seconds = Number(duration.trim());
  return Number.isFinite(seconds) ? seconds : undefined;
};

/**
 * Normalizes the flow control of a `withSettings` call.
 *
 * @param flowControl flow control as the user provided it
 */
export const normalizeFlowControl = (flowControl: FlowControl): NormalizedFlowControl => {
  const period =
    flowControl.period === undefined ? undefined : durationToSeconds(flowControl.period);
  return {
    key: flowControl.key,
    parallelism: flowControl.parallelism ?? DEFAULT_PARALLELISM,
    rate: flowControl.rate ?? flowControl.ratePerSecond ?? DEFAULT_RATE,
    period: period ?? DEFAULT_PERIOD_SECONDS,
  };
};

/**
 * Parses the flow control QStash reports on a delivery.
 *
 * The value is a list of `name=value` pairs, joined with "," by QStash
 * and with ", " by the SDK; both are accepted. Periods are reported in
 * whole seconds by QStash and as durations by the SDK. Fields which are
 * absent take the same defaults QStash applies, so that a flow control
 * published without them compares equal to the one reported back.
 *
 * @param key value of the `Upstash-Flow-Control-Key` header
 * @param value value of the `Upstash-Flow-Control-Value` header
 */
export const parseFlowControlHeaders = (
  key: string | null,
  value: string | null
): NormalizedFlowControl | undefined => {
  if (!key) {
    return undefined;
  }

  const flowControl: NormalizedFlowControl = {
    key,
    parallelism: DEFAULT_PARALLELISM,
    rate: DEFAULT_RATE,
    period: DEFAULT_PERIOD_SECONDS,
  };
  for (const entry of (value ?? "").split(",")) {
    const [name, rawValue] = entry.split("=").map((part) => part.trim());
    if (!name || rawValue === undefined) {
      continue;
    }
    switch (name) {
      case "parallelism": {
        flowControl.parallelism = Number(rawValue);
        break;
      }
      case "rate": {
        flowControl.rate = Number(rawValue);
        break;
      }
      case "period": {
        flowControl.period = durationToSeconds(rawValue) ?? DEFAULT_PERIOD_SECONDS;
        break;
      }
    }
  }

  return flowControl;
};

/**
 * Reads the configuration QStash applied to a delivery from its headers.
 *
 * The retry limit is sent unconditionally, so an absent header means the
 * QStash version does not report it rather than "the limit is zero" —
 * zero being a valid limit. A step's retries are left uncompared in that
 * case, and the run's configuration applies to it.
 *
 * @param headers headers of the incoming request
 */
export const getEffectiveConfig = (headers: Headers): EffectiveConfig => {
  const retriesHeader = headers.get(MAX_RETRIES_HEADER);
  return {
    flowControl: parseFlowControlHeaders(
      headers.get(FLOW_CONTROL_KEY_HEADER),
      headers.get(FLOW_CONTROL_VALUE_HEADER)
    ),
    retries: retriesHeader === null ? undefined : Number(retriesHeader),
    retryDelay: headers.get(RETRY_DELAY_HEADER) ?? undefined,
    hasStepConfig: headers.get(WORKFLOW_STEP_CONFIG_HEADER) === "true",
  };
};

/**
 * Describes how a step's settings differ from the configuration applied
 * to the delivery in hand, or undefined when they agree.
 *
 * Only the fields the step actually sets are compared. QStash falls back
 * to the trigger configuration field by field for retries and retry
 * delay, so a step which sets only `retries` legitimately keeps the
 * run's flow control; comparing flow control there would report a
 * mismatch on every delivery. Flow control itself is all or nothing on
 * the QStash side, so it is compared as a whole.
 *
 * @param stepSettings step-level settings of the step about to execute
 * @param effectiveConfig configuration applied to the current delivery
 * @returns a human readable description of the first mismatch, if any
 */
export const describeStepSettingsMismatch = (
  stepSettings: StepSettings,
  effectiveConfig: EffectiveConfig
): string | undefined => {
  if (stepSettings.flowControl) {
    const wanted = normalizeFlowControl(stepSettings.flowControl);
    const applied = effectiveConfig.flowControl;
    if (
      !applied ||
      applied.key !== wanted.key ||
      applied.parallelism !== wanted.parallelism ||
      applied.rate !== wanted.rate ||
      applied.period !== wanted.period
    ) {
      return (
        `flow control: expected ${JSON.stringify(wanted)},` +
        ` delivery has ${JSON.stringify(applied)}`
      );
    }
  }

  if (
    stepSettings.retries !== undefined &&
    effectiveConfig.retries !== undefined &&
    stepSettings.retries !== effectiveConfig.retries
  ) {
    return `retries: expected ${stepSettings.retries}, delivery has ${effectiveConfig.retries}`;
  }

  if (
    stepSettings.retryDelay !== undefined &&
    stepSettings.retryDelay !== effectiveConfig.retryDelay
  ) {
    return (
      `retry delay: expected '${stepSettings.retryDelay}',` +
      ` delivery has '${effectiveConfig.retryDelay ?? ""}'`
    );
  }

  return undefined;
};
