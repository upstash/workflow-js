import { WorkflowClient, WorkflowReceiver } from "../../types";

const VALID_REGIONS = ["EU_CENTRAL_1", "US_EAST_1"] as const;

export type QStashRegion = (typeof VALID_REGIONS)[number];

export const QSTASH_REGIONS: readonly QStashRegion[] = VALID_REGIONS;

export const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";

const SIGNING_KEY_VARIABLES = ["QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const;
const VARIABLES = ["QSTASH_URL", "QSTASH_TOKEN", ...SIGNING_KEY_VARIABLES] as const;

/**
 * QStash env variables of a region.
 *
 * All values come from the same set of env variables: the ones with the region
 * prefix (like US_EAST_1_QSTASH_TOKEN) or the ones without (like QSTASH_TOKEN).
 * They are never mixed.
 */
export type CredentialBundle = {
  /**
   * Region of the bundle. undefined if QSTASH_REGION is not set.
   */
  region?: QStashRegion;
  /**
   * Prefix of the env variables the bundle is read from, like "US_EAST_1_".
   * Empty if the env variables without region prefix are used.
   */
  prefix: string;
  /**
   * Whether the bundle is read from the env variables with the region prefix
   */
  usesRegionPrefix: boolean;

  url?: string;
  token?: string;
  currentSigningKey?: string;
  nextSigningKey?: string;

  hasToken: boolean;
  /**
   * Whether both signing keys are set
   */
  hasSigningKeys: boolean;
  /**
   * Whether any signing key env variable is set, with or without region prefix.
   *
   * If true, requests must be verified. Requests of a bundle without signing
   * keys are rejected.
   */
  verificationRequired: boolean;
};

/**
 * Client and receiver of a region
 */
export type RegionalHandler = {
  bundle: CredentialBundle;
  /**
   * undefined if there is no token for the region
   */
  client?: WorkflowClient;
  receiver?: WorkflowReceiver;
};

export type QStashHandlers = {
  /**
   * Region set with QSTASH_REGION. undefined if it's not set.
   */
  defaultRegion?: QStashRegion;
  /**
   * One handler per region. A single handler if QSTASH_REGION is not set.
   */
  handlers: RegionalHandler[];
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
  const prefix = usesRegionPrefix ? `${region}_` : "";
  const get = (variable: (typeof VARIABLES)[number]) => environment[prefix + variable] || undefined;

  const token = get("QSTASH_TOKEN");
  const currentSigningKey = get("QSTASH_CURRENT_SIGNING_KEY");
  const nextSigningKey = get("QSTASH_NEXT_SIGNING_KEY");

  return {
    region,
    prefix,
    usesRegionPrefix,
    url: get("QSTASH_URL"),
    token,
    currentSigningKey,
    nextSigningKey,
    hasToken: Boolean(token),
    hasSigningKeys: Boolean(currentSigningKey && nextSigningKey),
    verificationRequired: isAnySigningKeySet(environment),
  };
};

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
