/* eslint-disable @typescript-eslint/no-magic-numbers */
import { describe, expect, test } from "bun:test";
import {
  describeStepSettingsMismatch,
  durationToSeconds,
  getEffectiveConfig,
  parseFlowControlHeaders,
} from "./step-config";
import type { EffectiveConfig } from "./step-config";
import type { StepSettings } from "../types";
import { prepareFlowControl } from "./headers";
import type { FlowControl } from "@upstash/qstash";

describe("step config", () => {
  describe("durationToSeconds", () => {
    test("should convert duration strings", () => {
      expect(durationToSeconds("30s")).toBe(30);
      expect(durationToSeconds("1m")).toBe(60);
      expect(durationToSeconds("2h")).toBe(7200);
      expect(durationToSeconds("1d")).toBe(86_400);
    });

    test("should accept numbers and bare numeric strings", () => {
      // QStash reports periods as whole seconds without a unit
      expect(durationToSeconds(60)).toBe(60);
      expect(durationToSeconds("60")).toBe(60);
    });

    test("should return undefined for values it can't parse", () => {
      expect(durationToSeconds("soon")).toBeUndefined();
      expect(durationToSeconds(Number.NaN)).toBeUndefined();
    });
  });

  describe("parseFlowControlHeaders", () => {
    test("should accept the separator QStash uses and the one the SDK uses", () => {
      // QStash joins with ",", the SDK with ", "
      // an absent period takes the default QStash applies, one second
      expect(parseFlowControlHeaders("key", "parallelism=2,rate=10")).toEqual({
        key: "key",
        parallelism: 2,
        rate: 10,
        period: 1,
      });
      expect(parseFlowControlHeaders("key", "parallelism=2, rate=10")).toEqual({
        key: "key",
        parallelism: 2,
        rate: 10,
        period: 1,
      });
    });

    test("should normalize periods from both sides to seconds", () => {
      // QStash reports whole seconds, the SDK sends durations
      expect(parseFlowControlHeaders("key", "rate=1,period=60")?.period).toBe(60);
      expect(parseFlowControlHeaders("key", "rate=1, period=1m")?.period).toBe(60);
    });

    test("should return undefined without a key", () => {
      expect(parseFlowControlHeaders(null, "parallelism=2")).toBeUndefined();
    });
  });

  describe("round trip through the headers the SDK publishes", () => {
    // the SDK's own formatting must parse back to what was asked for,
    // otherwise a step gated by the SDK would look mismatched to it
    const cases: FlowControl[] = [
      { key: "k", parallelism: 1 },
      { key: "k", rate: 10 },
      { key: "k", ratePerSecond: 10 },
      { key: "k", rate: 10, period: 60 },
      { key: "k", rate: 10, period: "1m" },
      { key: "k", parallelism: 3, rate: 10, period: "2h" },
    ];

    for (const flowControl of cases) {
      test(`should round trip ${JSON.stringify(flowControl)}`, () => {
        const { flowControlKey, flowControlValue } = prepareFlowControl(flowControl);
        const mismatch = describeStepSettingsMismatch(
          { flowControl },
          {
            flowControl: parseFlowControlHeaders(flowControlKey, flowControlValue),
            retries: 0,
            hasStepConfig: true,
          }
        );
        expect(mismatch).toBeUndefined();
      });
    }
  });

  describe("getEffectiveConfig", () => {
    test("should leave retries unreported when the header is absent", () => {
      // the header is sent unconditionally, so absent means the QStash
      // version does not report it rather than "the limit is zero"
      const config = getEffectiveConfig(new Headers({}) as Headers);
      expect(config.retries).toBeUndefined();
      expect(config.flowControl).toBeUndefined();
      expect(config.hasStepConfig).toBeFalse();
    });

    test("should read the configuration QStash reports", () => {
      const config = getEffectiveConfig(
        new Headers({
          "Upstash-Flow-Control-Key": "k",
          "Upstash-Flow-Control-Value": "parallelism=2,period=60",
          "Upstash-Max-Retries": "5",
          "Upstash-Retry-Delay": "1000",
          "Upstash-Workflow-Step-Config": "true",
        }) as Headers
      );
      expect(config).toEqual({
        flowControl: { key: "k", parallelism: 2, rate: 0, period: 60 },
        retries: 5,
        retryDelay: "1000",
        hasStepConfig: true,
      });
    });
  });

  describe("describeStepSettingsMismatch", () => {
    const effectiveConfig: EffectiveConfig = {
      flowControl: { key: "k", parallelism: 2, rate: 0, period: 1 },
      retries: 5,
      retryDelay: "1000",
      hasStepConfig: true,
    };

    test("should treat a flow control published without a period as equal", () => {
      // QStash defaults an unset period to one second and reports it back,
      // so comparing it against "unset" would mismatch on every delivery
      expect(
        describeStepSettingsMismatch(
          { flowControl: { key: "k", parallelism: 2 } },
          {
            flowControl: parseFlowControlHeaders("k", "parallelism=2,period=1"),
            retries: 0,
            hasStepConfig: true,
          }
        )
      ).toBeUndefined();
    });

    test("should only compare the fields the step sets", () => {
      // a step which sets only retries keeps the run's flow control, so
      // flow control must not be compared for it
      expect(describeStepSettingsMismatch({ retries: 5 }, effectiveConfig)).toBeUndefined();
      expect(describeStepSettingsMismatch({ retryDelay: "1000" }, effectiveConfig)).toBeUndefined();
      expect(describeStepSettingsMismatch({}, effectiveConfig)).toBeUndefined();
    });

    test("should report a flow control mismatch", () => {
      const settings: StepSettings = { flowControl: { key: "other", parallelism: 2 } };
      expect(describeStepSettingsMismatch(settings, effectiveConfig)).toInclude("flow control");
    });

    test("should report missing flow control", () => {
      const settings: StepSettings = { flowControl: { key: "k", parallelism: 2 } };
      expect(
        describeStepSettingsMismatch(settings, { retries: 0, hasStepConfig: false })
      ).toInclude("flow control");
    });

    test("should report a retries mismatch, including zero", () => {
      expect(describeStepSettingsMismatch({ retries: 0 }, effectiveConfig)).toInclude("retries");
      expect(
        describeStepSettingsMismatch({ retries: 0 }, { retries: 0, hasStepConfig: false })
      ).toBeUndefined();
    });

    test("should not compare retries when QStash did not report a limit", () => {
      // an older QStash which doesn't send the header: the step runs
      // under the run's configuration rather than gating forever
      expect(
        describeStepSettingsMismatch({ retries: 5 }, { hasStepConfig: false })
      ).toBeUndefined();
    });

    test("should report a retry delay mismatch", () => {
      expect(describeStepSettingsMismatch({ retryDelay: "2000" }, effectiveConfig)).toInclude(
        "retry delay"
      );
    });
  });
});
