/**
 * Tests for how serve reads the QStash env variables: which token and signing
 * keys each region uses, and when requests are verified or rejected.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { Client, Receiver } from "@upstash/qstash";
import {
  DEFAULT_QSTASH_URL,
  getBundlePrefix,
  getRegionFromEnvironment,
  normalizeRegionHeader,
  readBundle,
  RegionalHandler,
} from "./utils";
import { getHandlersForRequest, getQStashHandlerOptions } from "./handlers";
import { WorkflowError } from "../../error";
import { verifyRequest } from "../../workflow-requests";
import { QStashClientExtraConfig, WorkflowClient, WorkflowReceiver } from "../../types";

// Constructing handler options with QSTASH_DEV=true makes the QStash Client
// fire a fire-and-forget dev-server spawn, which also latches a process-wide
// singleton inside @upstash/qstash — a later startDevServer() in the same bun
// process (dev-server-integration.test.ts) then no-ops on its own port.
// NODE_ENV=production short-circuits the spawn while leaving dev-mode
// credential resolution intact, keeping this file a pure unit test.
const processEnvironment = process.env as Record<string, string | undefined>;
let previousNodeEnvironment: string | undefined;
let previousToken: string | undefined;
let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeAll(() => {
  previousNodeEnvironment = processEnvironment.NODE_ENV;
  processEnvironment.NODE_ENV = "production";
  // a client created without a token would use QSTASH_TOKEN of the process
  previousToken = processEnvironment.QSTASH_TOKEN;
  delete processEnvironment.QSTASH_TOKEN;
});

afterAll(() => {
  if (previousNodeEnvironment === undefined) delete processEnvironment.NODE_ENV;
  else processEnvironment.NODE_ENV = previousNodeEnvironment;
  if (previousToken !== undefined) processEnvironment.QSTASH_TOKEN = previousToken;
});

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

// unique warnings: helpers below create the handlers once per region
const warnings = () => [...new Set(warn.mock.calls.map((call) => String(call[0])))];

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
const PLAIN = { QSTASH_TOKEN: "plain-token" };
const PLAIN_KEYS = {
  QSTASH_CURRENT_SIGNING_KEY: "plain-current-key",
  QSTASH_NEXT_SIGNING_KEY: "plain-next-key",
};
const REGION = { QSTASH_REGION: "US_EAST_1" };

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

type Options = {
  qstashClient?: WorkflowClient | QStashClientExtraConfig;
  receiver?: WorkflowReceiver | "set-to-undefined";
};

/**
 * What serve does with a request which has the given region header:
 * - error: set if the request fails before it's verified
 * - verification: keys which the request can be signed with. "none" if
 *   requests aren't verified at all.
 * - token/url: credentials of the client
 */
const getRequestOutcome = async (
  environment: Record<string, string>,
  regionHeader: string | null,
  options: Options = {}
) => {
  const { qstashHandlers } = getQStashHandlerOptions({
    environment: { ...environment },
    qstashClientOption: options.qstashClient,
    receiverConfig: options.receiver ?? "not-set",
  });
  // getHandlersForRequest throws if the requests of the region can't be handled
  let handler: RegionalHandler;
  try {
    handler = getHandlersForRequest(qstashHandlers, regionHeader);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowError);
    return { error: (error as Error).message };
  }

  const accepted: string[] = [];
  for (const key of ["us-current-key", "eu-current-key", "plain-current-key", "forged-key"]) {
    try {
      await verifyRequest(body, await sign(key), handler.receiver);
      accepted.push(key);
    } catch {
      // not accepted
    }
  }

  const http = handler.client.http as unknown as {
    authorization: string;
    baseUrl: string;
    devMode: boolean;
  };
  return {
    verification: handler.receiver
      ? accepted.length > 0
        ? accepted.join(",")
        : "rejects all"
      : "none",
    token: http.authorization.replace("Bearer ", ""),
    url: http.baseUrl,
    devMode: http.devMode,
  };
};

const REJECTED = { error: expect.stringContaining("are rejected. A QStash signing key is set") };

const getOutcomes = async (environment: Record<string, string>, options?: Options) => ({
  us: await getRequestOutcome(environment, "us-east-1", options),
  eu: await getRequestOutcome(environment, "eu-central-1", options),
});

describe("normalizeRegionHeader", () => {
  test("should normalize valid regions", () => {
    expect(normalizeRegionHeader("us-east-1")).toBe("US_EAST_1");
    expect(normalizeRegionHeader("EU-CENTRAL-1")).toBe("EU_CENTRAL_1");
    expect(normalizeRegionHeader("US_EAST_1")).toBe("US_EAST_1");
  });

  test("should return undefined for missing or invalid regions", () => {
    expect(normalizeRegionHeader(undefined)).toBeUndefined();
    expect(normalizeRegionHeader("")).toBeUndefined();
    expect(warnings()).toHaveLength(0);

    expect(normalizeRegionHeader("ap-south-1")).toBeUndefined();
    expect(warnings()[0]).toContain("UPSTASH-REGION");
  });
});

describe("getRegionFromEnvironment", () => {
  test("should read and normalize QSTASH_REGION", () => {
    expect(getRegionFromEnvironment({ QSTASH_REGION: "US_EAST_1" })).toBe("US_EAST_1");
    expect(getRegionFromEnvironment({ QSTASH_REGION: "eu-central-1" })).toBe("EU_CENTRAL_1");
    expect(getRegionFromEnvironment({})).toBeUndefined();
    expect(warnings()).toHaveLength(0);
  });

  test("should warn about an invalid QSTASH_REGION", () => {
    expect(getRegionFromEnvironment({ QSTASH_REGION: "us-west-2" })).toBeUndefined();
    expect(warnings()[0]).toContain("QSTASH_REGION");
  });
});

describe("readBundle", () => {
  test("should read env variables without prefix if there is no region", () => {
    expect(readBundle({ ...PLAIN, ...PLAIN_KEYS, ...US, ...US_KEYS })).toEqual({
      region: undefined,
      usesRegionPrefix: false,
      credentials: {
        url: undefined,
        token: "plain-token",
        currentSigningKey: "plain-current-key",
        nextSigningKey: "plain-next-key",
      },
      verification: "verify",
    });
  });

  test("should read env variables with region prefix if any of them is set", () => {
    const bundle = readBundle({ ...PLAIN, ...PLAIN_KEYS, ...US, ...US_KEYS }, "US_EAST_1");
    expect(bundle).toEqual({
      region: "US_EAST_1",
      usesRegionPrefix: true,
      credentials: {
        url: "https://us-qstash.upstash.io",
        token: "us-token",
        currentSigningKey: "us-current-key",
        nextSigningKey: "us-next-key",
      },
      verification: "verify",
    });
    expect(getBundlePrefix(bundle)).toBe("US_EAST_1_");
  });

  test("should not mix env variables with and without region prefix", () => {
    // a single env variable with the prefix is enough to ignore the ones without
    for (const variable of Object.keys({ ...US, ...US_KEYS })) {
      const bundle = readBundle({ ...PLAIN, ...PLAIN_KEYS, [variable]: "value" }, "US_EAST_1");
      expect(bundle.usesRegionPrefix).toBeTrue();
      expect(Object.values(bundle.credentials).filter(Boolean)).toEqual(["value"]);
    }
  });

  test("should read env variables without prefix if the region has none", () => {
    const bundle = readBundle({ ...PLAIN, ...PLAIN_KEYS, ...US, ...US_KEYS }, "EU_CENTRAL_1");
    expect(bundle).toMatchObject({
      region: "EU_CENTRAL_1",
      usesRegionPrefix: false,
      credentials: { token: "plain-token", currentSigningKey: "plain-current-key" },
    });
    expect(getBundlePrefix(bundle)).toBe("");

    // empty values don't count
    const empty = readBundle({ ...PLAIN, EU_CENTRAL_1_QSTASH_TOKEN: "" }, "EU_CENTRAL_1");
    expect(empty.usesRegionPrefix).toBeFalse();
    expect(empty.credentials.token).toBe("plain-token");
  });

  test("should set verification", () => {
    expect(readBundle({}).verification).toBe("none");
    expect(readBundle({ ...PLAIN }).verification).toBe("none");
    expect(readBundle({ ...PLAIN_KEYS }).verification).toBe("verify");

    // one signing key is enough
    expect(readBundle({ QSTASH_CURRENT_SIGNING_KEY: "key" }).verification).toBe("verify");
    expect(readBundle({ QSTASH_NEXT_SIGNING_KEY: "key" }).verification).toBe("verify");
    // rejected if a signing key is set anywhere else
    expect(readBundle({ ...US, ...EU_KEYS }, "US_EAST_1").verification).toBe("reject");
    expect(readBundle({ ...US, ...PLAIN_KEYS }, "US_EAST_1").verification).toBe("reject");
    expect(readBundle({ ...US_KEYS }).verification).toBe("reject");
  });
});

describe("without QSTASH_REGION", () => {
  test("should use env variables without prefix", async () => {
    const outcome = await getRequestOutcome({ ...PLAIN, ...PLAIN_KEYS }, null);
    expect(outcome).toEqual({
      verification: "plain-current-key",
      token: "plain-token",
      url: DEFAULT_QSTASH_URL,
      devMode: false,
    });

    // region header is ignored
    expect(await getRequestOutcome({ ...PLAIN, ...PLAIN_KEYS }, "eu-central-1")).toEqual(outcome);
    expect(warnings()).toHaveLength(0);
  });

  test("should use QSTASH_URL", async () => {
    const outcome = await getRequestOutcome(
      { ...PLAIN, QSTASH_URL: "https://plain-qstash.upstash.io" },
      null
    );
    expect(outcome.url).toBe("https://plain-qstash.upstash.io");
  });

  test("should not verify if no signing key is set", async () => {
    const outcome = await getRequestOutcome({ ...PLAIN }, null);
    expect(outcome.verification).toBe("none");
    expect(warnings()).toHaveLength(0);
  });

  test("should verify with the signing key which is set if only one is set", async () => {
    for (const variable of ["QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) {
      const outcome = await getRequestOutcome({ ...PLAIN, [variable]: "plain-current-key" }, null);
      expect(outcome.verification).toBe("plain-current-key");
    }
    expect(warnings()).toHaveLength(2);
    expect(warnings()[0]).toContain(
      "Only QSTASH_CURRENT_SIGNING_KEY is set. Requests are verified with it. Set QSTASH_NEXT_SIGNING_KEY too"
    );
  });

  test("should reject requests if signing keys are only set with a region prefix", async () => {
    for (const environment of [
      { ...PLAIN, ...US_KEYS },
      // invalid QSTASH_REGION
      { ...US, ...US_KEYS, QSTASH_REGION: "us-west-2" },
    ]) {
      const outcome = await getRequestOutcome(environment, "us-east-1");
      expect(outcome).toEqual(REJECTED);
    }
  });

  test("should create a client without a token", async () => {
    const outcome = await getRequestOutcome({}, null);
    expect(outcome).toEqual({
      verification: "none",
      token: "",
      url: DEFAULT_QSTASH_URL,
      devMode: false,
    });
  });
});

describe("with QSTASH_REGION", () => {
  test("should use token and signing keys of each region", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US, ...US_KEYS, ...EU, ...EU_KEYS });
    expect(outcomes).toEqual({
      us: {
        verification: "us-current-key",
        token: "us-token",
        url: "https://us-qstash.upstash.io",
        devMode: false,
      },
      eu: {
        verification: "eu-current-key",
        token: "eu-token",
        url: "https://eu-qstash.upstash.io",
        devMode: false,
      },
    });
    expect(warnings()).toHaveLength(0);
  });

  test("should ignore env variables without prefix if a region has its own", async () => {
    const outcomes = await getOutcomes({
      ...REGION,
      ...US,
      ...US_KEYS,
      ...EU,
      ...EU_KEYS,
      ...PLAIN,
      ...PLAIN_KEYS,
    });
    expect(outcomes.us).toMatchObject({ verification: "us-current-key", token: "us-token" });
    expect(outcomes.eu).toMatchObject({ verification: "eu-current-key", token: "eu-token" });
  });

  test("should use env variables without prefix in both regions if no other is set", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...PLAIN, ...PLAIN_KEYS });
    const expected = {
      verification: "plain-current-key",
      token: "plain-token",
      url: DEFAULT_QSTASH_URL,
      devMode: false,
    };
    expect(outcomes).toEqual({ us: expected, eu: expected });
    expect(warnings()).toHaveLength(0);
  });

  test("should use env variables without prefix for a region which doesn't have its own", async () => {
    // US has its own env variables, EU uses the ones without prefix
    const outcomes = await getOutcomes({ ...REGION, ...US, ...US_KEYS, ...PLAIN, ...PLAIN_KEYS });
    expect(outcomes.us).toMatchObject({ verification: "us-current-key", token: "us-token" });
    expect(outcomes.eu).toMatchObject({
      verification: "plain-current-key",
      token: "plain-token",
      url: DEFAULT_QSTASH_URL,
    });
    expect(warnings()).toHaveLength(0);
  });

  test("should reject requests if token has the region prefix but signing keys don't", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US, ...EU, ...PLAIN_KEYS });
    expect(outcomes.us).toEqual(REJECTED);
    expect(outcomes.eu).toEqual(REJECTED);

    expect(warnings()).toHaveLength(2);
    expect(warnings()[0]).toContain(
      "Requests from US_EAST_1 are rejected. A QStash signing key is set, but US_EAST_1_QSTASH_CURRENT_SIGNING_KEY and US_EAST_1_QSTASH_NEXT_SIGNING_KEY are not set."
    );
    expect(warnings()[1]).toContain("Requests from EU_CENTRAL_1 are rejected.");
  });

  test("should reject requests of a region without signing keys if the other has them", async () => {
    const us = await getOutcomes({ ...REGION, ...US, ...US_KEYS, ...EU });
    expect(us.us.verification).toBe("us-current-key");
    expect(us.eu).toEqual(REJECTED);

    const eu = await getOutcomes({ ...REGION, ...US, ...EU, ...EU_KEYS });
    expect(eu.us).toEqual(REJECTED);
    expect(eu.eu.verification).toBe("eu-current-key");

    // EU uses the env variables without prefix, which have no signing keys
    const plain = await getOutcomes({ ...REGION, ...US, ...US_KEYS, ...PLAIN });
    expect(plain.us.verification).toBe("us-current-key");
    expect(plain.eu).toEqual(REJECTED);
  });

  test("should reject requests if signing keys are set for a region without a token", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US, ...EU_KEYS });
    expect(outcomes.us).toEqual(REJECTED);
    expect(outcomes.eu).toEqual({
      error:
        "Received a request for region EU_CENTRAL_1, but EU_CENTRAL_1_QSTASH_TOKEN is not set.",
    });
  });

  test("should verify with the signing key which is set if only one is set", async () => {
    const outcomes = await getOutcomes({
      ...REGION,
      ...US,
      ...EU,
      US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
      EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY: "eu-current-key",
    });
    expect(outcomes.us.verification).toBe("us-current-key");
    expect(outcomes.eu.verification).toBe("eu-current-key");
    expect(warnings()).toContain(
      "[Upstash Workflow] Only EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY is set. Requests from EU_CENTRAL_1 are verified with it. Set EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY too, so that requests are verified when the keys are rotated."
    );

    // a region without any signing key is still rejected
    const onlyUs = await getOutcomes({
      ...REGION,
      ...US,
      ...EU,
      US_EAST_1_QSTASH_CURRENT_SIGNING_KEY: "us-current-key",
    });
    expect(onlyUs.us.verification).toBe("us-current-key");
    expect(onlyUs.eu).toEqual(REJECTED);
    expect(warnings().at(-1)).toContain(
      "Requests from EU_CENTRAL_1 are rejected. A QStash signing key is set, but EU_CENTRAL_1_QSTASH_CURRENT_SIGNING_KEY and EU_CENTRAL_1_QSTASH_NEXT_SIGNING_KEY are not set."
    );
  });

  test("should not verify if no signing key is set", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US, ...EU });
    expect(outcomes.us.verification).toBe("none");
    expect(outcomes.eu.verification).toBe("none");
    expect(warnings()).toHaveLength(0);
  });

  test("should fail requests of a region without a token", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US });
    expect(outcomes.us).toMatchObject({ verification: "none", token: "us-token" });
    expect(outcomes.eu).toEqual({
      error: "Received a request for region EU_CENTRAL_1, but QSTASH_TOKEN is not set.",
    });

    // EU has no env variable at all. US signing keys make verification required
    const withKeys = await getOutcomes({ ...REGION, ...US, ...US_KEYS });
    expect(withKeys.us).toMatchObject({ verification: "us-current-key", token: "us-token" });
    expect(withKeys.eu).toEqual(REJECTED);
  });

  test("should create a client without a token for the default region", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...EU });
    expect(outcomes.us).toEqual({
      verification: "none",
      token: "",
      url: DEFAULT_QSTASH_URL,
      devMode: false,
    });
    expect(outcomes.eu).toMatchObject({ verification: "none", token: "eu-token" });

    // doesn't throw without any credentials
    const empty = await getOutcomes({ ...REGION });
    expect(empty.us).toMatchObject({ verification: "none", token: "" });
  });

  test("should not use the token without prefix for the default region if it has its own env variables", async () => {
    const outcomes = await getOutcomes({ ...REGION, ...US_KEYS, ...PLAIN });
    expect(outcomes.us).toEqual({
      error: "Received a request for region US_EAST_1, but US_EAST_1_QSTASH_TOKEN is not set.",
    });
    // EU uses the env variables without prefix, which have no signing keys
    expect(outcomes.eu).toEqual(REJECTED);
  });

  test("should use the default url if the region has a token but no url", async () => {
    const outcomes = await getOutcomes({
      ...REGION,
      US_EAST_1_QSTASH_TOKEN: "us-token",
      ...PLAIN,
      QSTASH_URL: "https://plain-qstash.upstash.io",
    });
    expect(outcomes.us).toMatchObject({ token: "us-token", url: DEFAULT_QSTASH_URL });
    expect(outcomes.eu).toMatchObject({
      token: "plain-token",
      url: "https://plain-qstash.upstash.io",
    });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("US_EAST_1_QSTASH_URL is not set");
  });

  test("should use the region in QSTASH_REGION if the header is missing or invalid", async () => {
    const environment = { ...US, ...US_KEYS, ...EU, ...EU_KEYS };
    for (const header of [null, "", "ap-south-1"]) {
      const us = await getRequestOutcome({ ...environment, QSTASH_REGION: "US_EAST_1" }, header);
      expect(us).toMatchObject({ verification: "us-current-key", token: "us-token" });

      const eu = await getRequestOutcome({ ...environment, QSTASH_REGION: "eu-central-1" }, header);
      expect(eu).toMatchObject({ verification: "eu-current-key", token: "eu-token" });
    }
  });

  test("should return the handler of the default region as default", () => {
    const { defaultClient, defaultReceiver, qstashHandlers } = getQStashHandlerOptions({
      environment: { QSTASH_REGION: "EU_CENTRAL_1", ...US, ...US_KEYS, ...EU, ...EU_KEYS },
      receiverConfig: "not-set",
    });
    const eu = getHandlersForRequest(qstashHandlers, "eu-central-1");
    expect(qstashHandlers).toMatchObject({ mode: "multi-region", defaultRegion: "EU_CENTRAL_1" });
    expect(defaultClient).toBe(eu.client);
    expect(defaultReceiver).toBe(eu.receiver);
  });
});

describe("receiver option", () => {
  test("should use the receiver in options", async () => {
    const receiver = new Receiver({
      currentSigningKey: "plain-current-key",
      nextSigningKey: "plain-next-key",
    });
    const outcomes = await getOutcomes({ ...REGION, ...US, ...US_KEYS, ...EU }, { receiver });
    expect(outcomes.us.verification).toBe("plain-current-key");
    expect(outcomes.eu.verification).toBe("plain-current-key");
    expect(warnings()).toHaveLength(0);
  });

  test("should not verify if receiver is set to undefined", async () => {
    const outcomes = await getOutcomes(
      { ...REGION, ...US, ...US_KEYS, ...EU },
      { receiver: "set-to-undefined" }
    );
    expect(outcomes.us.verification).toBe("none");
    expect(outcomes.eu.verification).toBe("none");
    expect(warnings()).toHaveLength(0);

    const single = await getRequestOutcome({ ...PLAIN, ...PLAIN_KEYS }, null, {
      receiver: "set-to-undefined",
    });
    expect(single.verification).toBe("none");
  });
});

describe("qstashClient option", () => {
  test("should use the client in options", async () => {
    const qstashClient = new Client({
      baseUrl: "https://custom.upstash.io",
      token: "custom-token",
    });
    const single = await getRequestOutcome({ ...PLAIN, ...PLAIN_KEYS }, null, { qstashClient });
    expect(single).toMatchObject({
      verification: "plain-current-key",
      token: "custom-token",
      url: "https://custom.upstash.io",
    });
  });

  test("should use the client in options in all regions", async () => {
    const qstashClient = new Client({
      baseUrl: "https://custom.upstash.io",
      token: "custom-token",
    });
    const outcomes = await getOutcomes({ ...REGION, ...PLAIN_KEYS }, { qstashClient });
    expect(outcomes.us).toMatchObject({ verification: "plain-current-key", token: "custom-token" });
    expect(outcomes.eu).toMatchObject({ verification: "plain-current-key", token: "custom-token" });

    // signing keys of each region are used, token env variables aren't needed
    const prefixed = await getOutcomes({ ...REGION, ...US_KEYS, ...EU_KEYS }, { qstashClient });
    expect(prefixed.us).toMatchObject({ verification: "us-current-key", token: "custom-token" });
    expect(prefixed.eu).toMatchObject({ verification: "eu-current-key", token: "custom-token" });
    expect(warnings()).toHaveLength(0);

    // a region without signing keys is rejected if the other has them
    const onlyUs = await getOutcomes({ ...REGION, ...US_KEYS }, { qstashClient });
    expect(onlyUs.us).toMatchObject({ verification: "us-current-key", token: "custom-token" });
    expect(onlyUs.eu).toEqual(REJECTED);
  });

  test("should pass client config to the client of each region", () => {
    const { qstashHandlers } = getQStashHandlerOptions({
      environment: { ...REGION, ...US, ...EU },
      qstashClientOption: { retry: { retries: 7 } },
      receiverConfig: "not-set",
    });
    for (const header of ["us-east-1", "eu-central-1"]) {
      const { client } = getHandlersForRequest(qstashHandlers, header);
      expect((client.http as unknown as { retry: { attempts: number } }).retry.attempts).toBe(7);
    }
  });
});

describe("dev mode", () => {
  const DEV_URL = "http://127.0.0.1:8080";
  const expectDevMode = (outcome: Awaited<ReturnType<typeof getRequestOutcome>>) => {
    expect(outcome.devMode).toBe(true);
    expect(outcome.url).toBe(DEV_URL);
    // receiver uses the signing keys of the dev server, not the ones in env
    expect(outcome.verification).toBe("rejects all");
  };

  test("should use dev mode in all regions with QSTASH_DEV", async () => {
    for (const value of ["true", "1"]) {
      expectDevMode(await getRequestOutcome({ QSTASH_DEV: value }, null));
      expectDevMode(await getRequestOutcome({ QSTASH_DEV: value, ...PLAIN, ...PLAIN_KEYS }, null));

      const outcomes = await getOutcomes({ QSTASH_DEV: value, ...REGION, ...US, ...US_KEYS });
      expectDevMode(outcomes.us);
      expectDevMode(outcomes.eu);
    }
    expect(warnings().filter((warning) => warning.includes("Upstash Workflow"))).toHaveLength(0);
  });

  test("should not use dev mode with other QSTASH_DEV values", async () => {
    const outcome = await getRequestOutcome({ QSTASH_DEV: "false", ...PLAIN, ...PLAIN_KEYS }, null);
    expect(outcome).toMatchObject({ devMode: false, verification: "plain-current-key" });
  });

  test("should use dev mode with devMode in client config, without any token", async () => {
    const qstashClient = { devMode: true };
    expectDevMode(await getRequestOutcome({}, null, { qstashClient }));

    const outcomes = await getOutcomes({ ...REGION }, { qstashClient });
    expectDevMode(outcomes.us);
    expectDevMode(outcomes.eu);
  });

  test("should prefer devMode in client config over QSTASH_DEV", async () => {
    const outcomes = await getOutcomes(
      { QSTASH_DEV: "true", ...REGION, ...US, ...US_KEYS, ...EU, ...EU_KEYS },
      { qstashClient: { devMode: false } }
    );
    expect(outcomes.us).toEqual({
      verification: "us-current-key",
      token: "us-token",
      url: "https://us-qstash.upstash.io",
      devMode: false,
    });
    expect(outcomes.eu).toMatchObject({ verification: "eu-current-key", token: "eu-token" });
  });

  test("should not use the dev receiver if receiver is set to undefined", async () => {
    const outcome = await getRequestOutcome({ QSTASH_DEV: "true" }, null, {
      receiver: "set-to-undefined",
    });
    expect(outcome.verification).toBe("none");
  });
});
