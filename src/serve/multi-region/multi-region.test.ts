/**
 * Tests for multi-region support utilities.
 * Tests credential resolution and region handling.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Client, Receiver } from "@upstash/qstash";
import {
  getRegionFromEnvironment,
  normalizeRegionHeader,
  readClientEnvironmentVariables,
  readReceiverEnvironmentVariables,
} from "./utils";
import { getHandlersForRequest, getQStashHandlerOptions } from "./handlers";
import { WorkflowError } from "../../error";

// Constructing handler options with QSTASH_DEV=true makes the QStash Client
// fire a fire-and-forget dev-server spawn, which also latches a process-wide
// singleton inside @upstash/qstash — a later startDevServer() in the same bun
// process (dev-server-integration.test.ts) then no-ops on its own port.
// NODE_ENV=production short-circuits the spawn while leaving dev-mode
// credential resolution intact, keeping this file a pure unit test.
const processEnvironment = process.env as Record<string, string | undefined>;
let previousNodeEnvironment: string | undefined;

beforeAll(() => {
  previousNodeEnvironment = processEnvironment.NODE_ENV;
  processEnvironment.NODE_ENV = "production";
});

afterAll(() => {
  if (previousNodeEnvironment === undefined) delete processEnvironment.NODE_ENV;
  else processEnvironment.NODE_ENV = previousNodeEnvironment;
});

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

    test("should warn if only one of the signing keys is set", () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const single = getQStashHandlerOptions({
          environment: createEnvironment({
            QSTASH_TOKEN: "test-token",
            QSTASH_CURRENT_SIGNING_KEY: "current-key",
          }),
          receiverConfig: "not-set",
        });
        expect(single.defaultReceiver).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("QSTASH_NEXT_SIGNING_KEY");

        const regional = getQStashHandlerOptions({
          environment: createEnvironment({
            QSTASH_REGION: "US_EAST_1",
            US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
            US_EAST_1_QSTASH_TOKEN: "us-token",
            US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
          }),
          receiverConfig: "not-set",
        });
        expect(regional.defaultReceiver).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[1][0]).toContain("US_EAST_1_QSTASH_CURRENT_SIGNING_KEY");
      } finally {
        warn.mockRestore();
      }
    });

    test("should create dev-mode receiver when QSTASH_DEV=true and signing keys are missing", () => {
      const environment = createEnvironment({
        QSTASH_DEV: "true",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultReceiver).toBeInstanceOf(Receiver);
    });

    test("should create dev-mode receiver when QSTASH_DEV=1", () => {
      const environment = createEnvironment({
        QSTASH_DEV: "1",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      expect(result.defaultReceiver).toBeInstanceOf(Receiver);
    });

    test("should ignore QSTASH_DEV when receiver is set-to-undefined", () => {
      const environment = createEnvironment({
        QSTASH_DEV: "true",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "set-to-undefined",
      });

      expect(result.defaultReceiver).toBeUndefined();
    });

    test("should prefer QSTASH_DEV over real signing keys in env", async () => {
      const environment = createEnvironment({
        QSTASH_DEV: "true",
        QSTASH_CURRENT_SIGNING_KEY: "real-current",
        QSTASH_NEXT_SIGNING_KEY: "real-next",
      });

      const result = getQStashHandlerOptions({
        environment,
        receiverConfig: "not-set",
      });

      // The dev-mode receiver should reject signatures forged with the real keys
      // we passed in env, because qstash-js swaps in the well-known dev keys.
      expect(result.defaultReceiver).toBeInstanceOf(Receiver);
      await expect(
        result.defaultReceiver!.verify({
          signature: "not-a-valid-signature",
          body: "{}",
        })
      ).rejects.toThrow();
    });

    test("should not enter dev mode for QSTASH_DEV=false", () => {
      const environment = createEnvironment({
        QSTASH_DEV: "false",
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

  describe("Client Dev Mode (derived from environment)", () => {
    // Pins the fix for the receiver-dev / client-prod split: a single
    // QSTASH_DEV=true (e.g. a Cloudflare `.dev.vars` binding, where the QStash
    // Client's own process.env lookup is blind) must put the *client* in dev
    // mode too, matching the receiver. Asserted on the constructed serve Client.
    const getServeClientHttp = (
      environment: Record<string, string | undefined>,
      qstashClientOption?: { devMode?: boolean }
    ) => {
      // Entering dev mode makes the Client fire a fire-and-forget dev-server
      // spawn. NODE_ENV=production short-circuits the spawn while leaving
      // credential resolution in dev mode, keeping this a pure unit test.
      const processEnv = process.env as Record<string, string | undefined>;
      const previousNodeEnv = processEnv.NODE_ENV;
      processEnv.NODE_ENV = "production";
      try {
        const result = getQStashHandlerOptions({
          environment,
          qstashClientOption,
          receiverConfig: "not-set",
        });
        return result.defaultClient.http as unknown as { baseUrl: string; devMode?: boolean };
      } finally {
        if (previousNodeEnv === undefined) delete processEnv.NODE_ENV;
        else processEnv.NODE_ENV = previousNodeEnv;
      }
    };

    test("should put the serve client in dev mode when QSTASH_DEV=true", () => {
      const http = getServeClientHttp(createEnvironment({ QSTASH_DEV: "true" }));
      expect(http.devMode).toBe(true);
      expect(http.baseUrl).toContain("127.0.0.1");
    });

    test("should put the serve client in dev mode when QSTASH_DEV=1", () => {
      const http = getServeClientHttp(createEnvironment({ QSTASH_DEV: "1" }));
      expect(http.devMode).toBe(true);
      expect(http.baseUrl).toContain("127.0.0.1");
    });

    test("should keep the serve client pointed at production without QSTASH_DEV", () => {
      const http = getServeClientHttp(
        createEnvironment({
          QSTASH_URL: "https://qstash.upstash.io",
          QSTASH_TOKEN: "test-token",
        })
      );
      expect(http.devMode).toBe(false);
      expect(http.baseUrl).toBe("https://qstash.upstash.io");
    });

    // devMode in the user's qstashClient config takes precedence over the
    // env-derived value, in both directions — the env check is only a fallback.
    test("explicit qstashClient devMode: true wins without QSTASH_DEV", () => {
      const http = getServeClientHttp(
        createEnvironment({
          QSTASH_URL: "https://qstash.upstash.io",
          QSTASH_TOKEN: "test-token",
        }),
        { devMode: true }
      );
      expect(http.devMode).toBe(true);
      expect(http.baseUrl).toContain("127.0.0.1");
    });

    test("explicit qstashClient devMode: false wins over QSTASH_DEV=true", () => {
      const http = getServeClientHttp(
        createEnvironment({
          QSTASH_DEV: "true",
          QSTASH_URL: "https://qstash.upstash.io",
          QSTASH_TOKEN: "test-token",
        }),
        { devMode: false }
      );
      expect(http.devMode).toBe(false);
      expect(http.baseUrl).toBe("https://qstash.upstash.io");
    });
  });
});

describe("getHandlersForRequest - regional receivers", () => {
  const body = "body";
  const encoder = new TextEncoder();

  /**
   * creates a signature for the body with the given signing key
   */
  const sign = async (key: string) => {
    const bodyHash = Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(body)))
      .toString("base64url")
      .replaceAll("=", "");
    const unsigned = [
      { alg: "HS256", typ: "JWT" },
      { iss: "Upstash", sub: "", exp: 9_999_999_999, nbf: 0, body: bodyHash },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".");
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(unsigned));
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  };

  const US = {
    US_EAST_1_QSTASH_URL: "https://us-qstash.upstash.io",
    US_EAST_1_QSTASH_TOKEN: "us-token",
  };
  const US_KEYS = {
    US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
    US_EAST_1_QSTASH_NEXT_SIGNING_KEY: "us-next-key",
  };
  const EU = {
    EU_CENTRAL_1_QSTASH_URL: "https://eu-qstash.upstash.io",
    EU_CENTRAL_1_QSTASH_TOKEN: "eu-token",
  };
  const EU_KEYS = {
    EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
    EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-next-key",
  };
  const DEFAULT = { QSTASH_TOKEN: "default-token" };
  const DEFAULT_KEYS = {
    QSTASH_CURRENT_SIGNING_KEY: "default-current-key",
    QSTASH_NEXT_SIGNING_KEY: "default-next-key",
  };

  /**
   * returns the token and the receiver used for each region. default region is US.
   */
  const getHandlers = (
    environment: Record<string, string>,
    receiverConfig: "not-set" | "set-to-undefined" = "not-set"
  ) => {
    const { qstashHandlers } = getQStashHandlerOptions({
      environment: createEnvironment({ QSTASH_REGION: "US_EAST_1", ...environment }),
      receiverConfig,
    });
    const get = (regionHeader: string) => {
      const { client, receiver } = getHandlersForRequest(qstashHandlers, regionHeader, false);
      const { authorization } = client.http as unknown as { authorization: string };
      return { token: authorization.replace("Bearer ", ""), receiver };
    };
    return { us: get("us-east-1"), eu: get("eu-central-1") };
  };

  test("should use token and signing keys of each region", async () => {
    const { us, eu } = getHandlers({ ...US, ...US_KEYS, ...EU, ...EU_KEYS });

    expect(us.token).toBe("us-token");
    expect(eu.token).toBe("eu-token");

    const usSignature = await sign("us-current-key");
    const euSignature = await sign("eu-current-key");
    expect(await us.receiver!.verify({ body, signature: usSignature })).toBeTrue();
    expect(us.receiver!.verify({ body, signature: euSignature })).rejects.toThrow();
    expect(await eu.receiver!.verify({ body, signature: euSignature })).toBeTrue();
    expect(eu.receiver!.verify({ body, signature: usSignature })).rejects.toThrow();
  });

  test("should throw for a region which is not configured", () => {
    const { qstashHandlers } = getQStashHandlerOptions({
      environment: createEnvironment({ QSTASH_REGION: "US_EAST_1", ...US, ...US_KEYS }),
      receiverConfig: "not-set",
    });

    expect(getHandlersForRequest(qstashHandlers, "us-east-1", false).receiver).toBeInstanceOf(
      Receiver
    );
    expect(() => getHandlersForRequest(qstashHandlers, "eu-central-1", false)).toThrow(
      WorkflowError
    );
  });

  test("should not use env variables without region prefix", () => {
    const { us, eu } = getHandlers({ ...US, ...EU, ...DEFAULT, ...DEFAULT_KEYS });

    expect(us.token).toBe("us-token");
    expect(eu.token).toBe("eu-token");
    expect(us.receiver).toBeUndefined();
    expect(eu.receiver).toBeUndefined();
  });

  test("should throw if only some of the regions have signing keys", () => {
    expect(() => getHandlers({ ...US, ...US_KEYS, ...EU })).toThrow(WorkflowError);
    expect(() => getHandlers({ ...US, ...EU, ...EU_KEYS })).toThrow(WorkflowError);
    expect(() =>
      getHandlers({
        ...US,
        ...US_KEYS,
        ...EU,
        EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY: "eu-current-key",
      })
    ).toThrow(WorkflowError);

    // signing keys in env aren't used if receiver is set to undefined
    expect(() => getHandlers({ ...US, ...US_KEYS, ...EU }, "set-to-undefined")).not.toThrow();
  });

  test("should throw if the default region is not configured", () => {
    expect(() => getHandlers({ ...EU, ...EU_KEYS })).toThrow(WorkflowError);
    // env variables without region prefix aren't used in multi-region mode
    expect(() => getHandlers({ ...DEFAULT, ...DEFAULT_KEYS })).toThrow(WorkflowError);
  });

  test("should return no receiver when no signing keys are set", () => {
    const { us, eu } = getHandlers({ ...US, ...EU });
    expect(us.receiver).toBeUndefined();
    expect(eu.receiver).toBeUndefined();
  });

  test("should return no receiver when receiver is set to undefined", () => {
    const { us, eu } = getHandlers({ ...US, ...US_KEYS, ...EU, ...EU_KEYS }, "set-to-undefined");
    expect(us.receiver).toBeUndefined();
    expect(eu.receiver).toBeUndefined();
  });
});
