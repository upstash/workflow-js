import { WorkflowClient, WorkflowReceiver } from "../../types";

const VALID_REGIONS = ["EU_CENTRAL_1", "US_EAST_1"] as const;

export type QStashRegion = (typeof VALID_REGIONS)[number];

export const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";

const SIGNING_KEY_VARIABLES = ["QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const;
const VARIABLES = ["QSTASH_URL", "QSTASH_TOKEN", ...SIGNING_KEY_VARIABLES] as const;

/**
 * QStash env variables of a region.
 *
 * All credentials come from the same set of env variables: the ones with the
 * region prefix (like US_EAST_1_QSTASH_TOKEN) or the ones without (like
 * QSTASH_TOKEN). They are never mixed.
 */
export type CredentialBundle = {
  /**
   * Region of the bundle. undefined if QSTASH_REGION is not set.
   */
  region?: QStashRegion;
  /**
   * Whether the credentials are read from the env variables with the region prefix
   */
  usesRegionPrefix: boolean;
  credentials: {
    url?: string;
    token?: string;
    currentSigningKey?: string;
    nextSigningKey?: string;
  };
  /**
   * What to do with the requests of the region:
   * - "verify": a signing key is set, requests are verified. If only one of
   *   the two is set, it's used for both.
   * - "reject": signing keys are missing, but a signing key env variable is set
   *   somewhere (with or without region prefix). Requests are never accepted
   *   without verification in that case, so all are rejected.
   * - "none": no signing key env variable is set at all. Requests aren't verified.
   */
  verification: "verify" | "reject" | "none";
};

/**
 * Prefix of the env variables the bundle is read from, like "US_EAST_1_".
 * Empty if the env variables without region prefix are used.
 */
export const getBundlePrefix = ({ region, usesRegionPrefix }: CredentialBundle) =>
  usesRegionPrefix ? `${region}_` : "";

/**
 * Regional handler containing client and optional receiver
 */
export type RegionalHandler = {
  client: WorkflowClient;
  receiver?: WorkflowReceiver;
  /**
   * Set if the requests of the region can't be handled. Such requests fail with this error.
   */
  error?: string;
};

/**
 * QStash handlers for single or multi-region mode
 */
export type QStashHandlers =
  | {
      mode: "single-region";
      handlers: RegionalHandler;
    }
  | {
      mode: "multi-region";
      handlers: Record<QStashRegion, RegionalHandler>;
      defaultRegion: QStashRegion;
    };

export const getRegionFromEnvironment = (
  environment: Record<string, string | undefined>
): QStashRegion | undefined => {
  const region = normalizeRegion(environment.QSTASH_REGION);
  if (environment.QSTASH_REGION && !region) {
    console.warn(
      `[Upstash Workflow] Invalid QSTASH_REGION value: "${environment.QSTASH_REGION}". Expected one of: ${VALID_REGIONS.join(
        ", "
      )}.`
    );
  }
  return region;
};

/**
 * Whether any signing key env variable is set, with or without region prefix
 */
const isAnySigningKeySet = (environment: Record<string, string | undefined>) => {
  const prefixes = ["", ...VALID_REGIONS.map((region) => `${region}_`)];
  return prefixes.some((prefix) =>
    SIGNING_KEY_VARIABLES.some((variable) => Boolean(environment[prefix + variable]))
  );
};

/**
 * Reads the QStash env variables of a region.
 *
 * If any env variable with the region prefix is set, all values are read from
 * the ones with the prefix. Otherwise, all are read from the ones without.
 */
export const readBundle = (
  environment: Record<string, string | undefined>,
  region?: QStashRegion
): CredentialBundle => {
  const usesRegionPrefix = Boolean(
    region && VARIABLES.some((variable) => environment[`${region}_${variable}`])
  );
  const prefixRegion = usesRegionPrefix ? region : undefined;

  const { QSTASH_URL, QSTASH_TOKEN } = readClientEnvironmentVariables(environment, prefixRegion);
  const { QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY } = readReceiverEnvironmentVariables(
    environment,
    prefixRegion
  );

  return {
    region,
    usesRegionPrefix,
    // empty values count as not set
    credentials: {
      url: QSTASH_URL || undefined,
      token: QSTASH_TOKEN || undefined,
      currentSigningKey: QSTASH_CURRENT_SIGNING_KEY || undefined,
      nextSigningKey: QSTASH_NEXT_SIGNING_KEY || undefined,
    },
    verification:
      QSTASH_CURRENT_SIGNING_KEY || QSTASH_NEXT_SIGNING_KEY
        ? "verify"
        : isAnySigningKeySet(environment)
          ? "reject"
          : "none",
  };
};

function readEnvironmentVariables<T extends readonly string[]>(
  environmentVariables: T,
  environment: Record<string, string | undefined>,
  region?: QStashRegion
): Record<T[number], string | undefined> {
  const result: Record<string, string | undefined> = {};

  for (const variable of environmentVariables) {
    const key = region ? `${region}_${variable}` : variable;
    result[variable] = environment[key];
  }

  return result as Record<T[number], string | undefined>;
}

export function readClientEnvironmentVariables(
  environment: Record<string, string | undefined>,
  region?: QStashRegion
) {
  return readEnvironmentVariables(["QSTASH_URL", "QSTASH_TOKEN"] as const, environment, region);
}

export function readReceiverEnvironmentVariables(
  environment: Record<string, string | undefined>,
  region?: QStashRegion
) {
  return readEnvironmentVariables(SIGNING_KEY_VARIABLES, environment, region);
}

const normalizeRegion = (region: string | undefined): QStashRegion | undefined => {
  const normalized = region?.replaceAll("-", "_").toUpperCase();
  return VALID_REGIONS.includes(normalized as QStashRegion)
    ? (normalized as QStashRegion)
    : undefined;
};

export function normalizeRegionHeader(region: string | undefined): QStashRegion | undefined {
  if (!region) {
    return undefined;
  }

  const normalized = normalizeRegion(region);
  if (!normalized) {
    console.warn(
      `[Upstash Workflow] Invalid UPSTASH-REGION header value: "${region}". Expected one of: ${VALID_REGIONS.join(
        ", "
      )}.`
    );
  }

  return normalized;
}
