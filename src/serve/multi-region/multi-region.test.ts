/**
 * Tests for multi-region support utilities.
 * Tests credential resolution and region handling.
 */

import { describe, expect, test } from "bun:test";
import { Client, Receiver } from "@upstash/qstash";
import {
  getRegionFromEnvironment,
  normalizeRegionHeader,
  readClientEnvironmentVariables,
  readReceiverEnvironmentVariables,
} from "./utils";
import { getQStashHandlerOptions } from "./handlers";

// Helper to create a clean environment for each test
const createEnvironment = (
  environment: Record<string, string>
): Record<string, string | undefined> => {
  return { ...environment };
};

describe("Multi-Region Utilities", () => {
  describe("normalizeRegionHeader", () => {
    test("should normalize hyphenated region to underscores", () => {
      expect(normalizeRegionHeader("us-east-1")).toBe("US_EAST_1");
      expect(normalizeRegionHeader("eu-central-1")).toBe("EU_CENTRAL_1");
    });

    test("should normalize lowercase region to uppercase", () => {
      expect(normalizeRegionHeader("us_east_1")).toBe("US_EAST_1");
      expect(normalizeRegionHeader("eu_central_1")).toBe("EU_CENTRAL_1");
    });

    test("should accept correctly formatted regions", () => {
      expect(normalizeRegionHeader("US_EAST_1")).toBe("US_EAST_1");
      expect(normalizeRegionHeader("EU_CENTRAL_1")).toBe("EU_CENTRAL_1");
    });

    test("should return undefined for invalid regions", () => {
      expect(normalizeRegionHeader("INVALID_REGION")).toBeUndefined();
      expect(normalizeRegionHeader("ap-south-1")).toBeUndefined();
    });

    test("should return undefined for undefined input", () => {
      expect(normalizeRegionHeader(undefined)).toBeUndefined();
    });

    test("should return undefined for empty string", () => {
      expect(normalizeRegionHeader("")).toBeUndefined();
    });
  });

  describe("getRegionFromEnvironment", () => {
    test("should read QSTASH_REGION from environment", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
      });

      expect(getRegionFromEnvironment(environment)).toBe("US_EAST_1");
    });

    test("should normalize region from environment", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "us-east-1",
      });

      expect(getRegionFromEnvironment(environment)).toBe("US_EAST_1");
    });

    test("should return undefined when QSTASH_REGION is not set", () => {
      const environment = createEnvironment({});

      expect(getRegionFromEnvironment(environment)).toBeUndefined();
    });

    test("should return undefined for invalid region in environment", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "INVALID",
      });

      expect(getRegionFromEnvironment(environment)).toBeUndefined();
    });
  });

  describe("readClientEnvironmentVariables", () => {
    test("should read default client credentials", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const result = readClientEnvironmentVariables(environment);

      expect(result.QSTASH_URL).toBe("https://qstash.upstash.io");
      expect(result.QSTASH_TOKEN).toBe("test-token");
    });

    test("should read region-specific client credentials", () => {
      const environment = createEnvironment({
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
      });

      const result = readClientEnvironmentVariables(environment, "US_EAST_1");

      expect(result.QSTASH_URL).toBe("https://us-qstash.upstash.io");
      expect(result.QSTASH_TOKEN).toBe("us-token");
    });

    test("should return undefined for missing credentials", () => {
      const environment = createEnvironment({});

      const result = readClientEnvironmentVariables(environment);

      expect(result.QSTASH_URL).toBeUndefined();
      expect(result.QSTASH_TOKEN).toBeUndefined();
    });

    test("should read EU region credentials", () => {
      const environment = createEnvironment({
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const result = readClientEnvironmentVariables(environment, "EU_CENTRAL_1");

      expect(result.QSTASH_URL).toBe("https://eu-qstash.upstash.io");
      expect(result.QSTASH_TOKEN).toBe("eu-token");
    });
  });

  describe("readReceiverEnvironmentVariables", () => {
    test("should read default receiver credentials", () => {
      const environment = createEnvironment({
        QSTASH_CURRENT_SIGNING_KEY: "current-key",
        QSTASH_NEXT_SIGNING_KEY: "next-key",
      });

      const result = readReceiverEnvironmentVariables(environment);

      expect(result.QSTASH_CURRENT_SIGNING_KEY).toBe("current-key");
      expect(result.QSTASH_NEXT_SIGNING_KEY).toBe("next-key");
    });

    test("should read region-specific receiver credentials", () => {
      const environment = createEnvironment({
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
      });

      const result = readReceiverEnvironmentVariables(environment, "US_EAST_1");

      expect(result.QSTASH_CURRENT_SIGNING_KEY).toBe("us-current-key");
      expect(result.QSTASH_NEXT_SIGNING_KEY).toBe("us-next-key");
    });

    test("should return undefined for missing credentials", () => {
      const environment = createEnvironment({});

      const result = readReceiverEnvironmentVariables(environment);

      expect(result.QSTASH_CURRENT_SIGNING_KEY).toBeUndefined();
      expect(result.QSTASH_NEXT_SIGNING_KEY).toBeUndefined();
    });

    test("should read EU region credentials", () => {
      const environment = createEnvironment({
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const result = readReceiverEnvironmentVariables(environment, "EU_CENTRAL_1");

      expect(result.QSTASH_CURRENT_SIGNING_KEY).toBe("eu-current-key");
      expect(result.QSTASH_NEXT_SIGNING_KEY).toBe("eu-next-key");
    });
  });
});

describe("QStash Handler Options - Multi-Region Mode Detection", () => {
  describe("Single-Region Mode (Default)", () => {
    test("should use single-region mode with default credentials", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
        QSTASH_CURRENT_SIGNING_KEY: "current-key",
        QSTASH_NEXT_SIGNING_KEY: "next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("single-region");
      expect(result.defaultClient).toBeDefined();
      expect(result.defaultReceiver).toBeDefined();
    });

    test("should use single-region mode when QSTASH_REGION is not set", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("single-region");
    });

    test("should use single-region mode when client instance is provided", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
      });

      const client = new Client({
        baseUrl: "https://custom.upstash.io",
        token: "custom-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        qstashClientOption: client,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("single-region");
      if (result.qstashHandlers.mode === "single-region") {
        expect(result.qstashHandlers.handlers.client).toBe(client);
      }
    });
  });

  describe("Multi-Region Mode", () => {
    test("should enable multi-region mode when QSTASH_REGION is set", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
      if (result.qstashHandlers.mode === "multi-region") {
        expect(result.qstashHandlers.defaultRegion).toBe("US_EAST_1");
        expect(result.qstashHandlers.handlers["US_EAST_1"]).toBeDefined();
        expect(result.qstashHandlers.handlers["EU_CENTRAL_1"]).toBeDefined();
      }
    });

    test("should use US_EAST_1 as default region when specified", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
      if (result.qstashHandlers.mode === "multi-region") {
        expect(result.qstashHandlers.defaultRegion).toBe("US_EAST_1");
      }
    });

    test("should use EU_CENTRAL_1 as default region when specified", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "EU_CENTRAL_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
      if (result.qstashHandlers.mode === "multi-region") {
        expect(result.qstashHandlers.defaultRegion).toBe("EU_CENTRAL_1");
      }
    });

    test("should enable multi-region mode with client config options", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        qstashClientOption: {
          retry: {
            retries: 3,
          },
        },
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
    });

    test("should create handlers for both regions in multi-region mode", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
      if (result.qstashHandlers.mode === "multi-region") {
        const usHandler = result.qstashHandlers.handlers["US_EAST_1"];
        const euHandler = result.qstashHandlers.handlers["EU_CENTRAL_1"];

        expect(usHandler.client).toBeDefined();
        expect(usHandler.receiver).toBeDefined();
        expect(euHandler.client).toBeDefined();
        expect(euHandler.receiver).toBeDefined();
      }
    });
  });

  describe("Receiver Configuration", () => {
    test("should use receiver from config when provided", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const customReceiver = new Receiver({
        currentSigningKey: "config-current",
        nextSigningKey: "config-next",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: customReceiver,
      });

      expect(result.defaultReceiver).toBe(customReceiver);
    });

    test("should not create receiver when explicitly set to undefined", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
        QSTASH_CURRENT_SIGNING_KEY: "current-key",
        QSTASH_NEXT_SIGNING_KEY: "next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "set-to-undefined",
      });

      expect(result.defaultReceiver).toBeUndefined();
    });

    test("should create receiver from env when not set", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
        QSTASH_CURRENT_SIGNING_KEY: "current-key",
        QSTASH_NEXT_SIGNING_KEY: "next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultReceiver).toBeDefined();
    });

    test("should not create receiver when env vars are missing", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultReceiver).toBeUndefined();
    });

    test("should create region-specific receivers in multi-region mode", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
        US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
        EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      if (result.qstashHandlers.mode === "multi-region") {
        expect(result.qstashHandlers.handlers["US_EAST_1"].receiver).toBeDefined();
        expect(result.qstashHandlers.handlers["EU_CENTRAL_1"].receiver).toBeDefined();
      }
    });
  });

  describe("Fallback Behavior", () => {
    test("should handle missing region credentials gracefully", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        // EU_CENTRAL_1 credentials missing
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.qstashHandlers.mode).toBe("multi-region");
      if (result.qstashHandlers.mode === "multi-region") {
        // US should be created
        expect(result.qstashHandlers.handlers["US_EAST_1"]).toBeDefined();
        // EU might not be created or might be undefined, depending on implementation
      }
    });

    test("should normalize invalid QSTASH_REGION and fallback to single-region", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "INVALID_REGION",
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      // Should fallback to single-region mode
      expect(result.qstashHandlers.mode).toBe("single-region");
    });
  });

  describe("Default Client and Receiver", () => {
    test("should return default client in single-region mode", () => {
      const environment = createEnvironment({
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "test-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultClient).toBeDefined();
      expect(result.defaultClient.http).toBeDefined();
    });

    test("should return default region client in multi-region mode", () => {
      const environment = createEnvironment({
        QSTASH_REGION: "US_EAST_1",
        US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
        US_EAST_1_QSTASH_TOKEN: "us-token",
        EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
        EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultClient).toBeDefined();
      // Default client should be from US_EAST_1 since that's the default region
      expect(result.defaultClient.http).toBeDefined();
    });
  });
});
