import { Client, Receiver } from "@upstash/qstash";
import {
  CredentialBundle,
  DEFAULT_QSTASH_URL,
  getRegionFromEnvironment,
  normalizeRegionHeader,
  QStashHandlers,
  QStashRegion,
  readBundle,
  RegionalHandler,
} from "./utils";
import { QStashClientExtraConfig, WorkflowClient, WorkflowReceiver } from "../../types";
import { WorkflowError } from "../../error";

type QStashClientOption = WorkflowClient | QStashClientExtraConfig | undefined;

/**
 * - "set-to-undefined" if user explicitly set receiver to undefined in options
 * - "not-set" if user did not pass receiver in options
 * - WorkflowReceiver if user passed a receiver instance in options
 */
type ReceiverConfig = WorkflowReceiver | "set-to-undefined" | "not-set";

/**
 * Get the handler of the region the request comes from.
 *
 * If QSTASH_REGION is set, region is read from the UPSTASH-REGION header.
 * Requests without a valid header use the region in QSTASH_REGION.
 */
export const getHandlersForRequest = (
  qstashHandlers: QStashHandlers,
  regionHeader: string | null
): RegionalHandler => {
  if (qstashHandlers.mode === "single-region") {
    return qstashHandlers.handlers;
  }

  const region = normalizeRegionHeader(regionHeader ?? undefined) ?? qstashHandlers.defaultRegion;
  return qstashHandlers.handlers[region];
};

/**
 * Get the client of a handler. Throws if there is no QStash token for its region.
 *
 * Should be called after the request is verified.
 */
export const getClientForRequest = ({
  client,
  bundle,
  missingToken,
}: RegionalHandler): WorkflowClient => {
  if (missingToken) {
    throw new WorkflowError(
      `Received a request for region ${bundle.region}, but ${bundle.prefix}QSTASH_TOKEN is not set.`
    );
  }
  return client;
};

/**
 * Dev mode is used if it's set in the qstashClient option. Otherwise, if
 * QSTASH_DEV is set.
 *
 * Both the client and the receiver follow this, so a single QSTASH_DEV=true
 * (which may come from the Cloudflare worker `env` binding rather than
 * process.env) puts both in dev mode.
 */
const isDevMode = (
  environment: Record<string, string | undefined>,
  qstashClientOption: QStashClientOption
): boolean => {
  const fromOption =
    qstashClientOption && !("http" in qstashClientOption) ? qstashClientOption.devMode : undefined;
  return fromOption ?? (environment.QSTASH_DEV === "true" || environment.QSTASH_DEV === "1");
};

const getClient = (
  bundle: CredentialBundle,
  qstashClientOption: QStashClientOption,
  devMode: boolean
): WorkflowClient => {
  if (qstashClientOption && "http" in qstashClientOption) {
    return qstashClientOption;
  }

  if (devMode) {
    return new Client({ ...qstashClientOption, devMode });
  }

  return new Client({
    ...qstashClientOption,
    baseUrl: bundle.url ?? DEFAULT_QSTASH_URL,
    token: bundle.token,
    devMode,
  });
};

/**
 * Receiver which rejects all requests
 */
const getRejectingReceiver = (bundle: CredentialBundle): WorkflowReceiver => ({
  verify: () => {
    throw new Error(
      `QStash signing keys are not set for ${bundle.region ? `region ${bundle.region}` : "this endpoint"}.`
    );
  },
});

const getReceiver = (
  bundle: CredentialBundle,
  receiverConfig: ReceiverConfig,
  devMode: boolean
): WorkflowReceiver | undefined => {
  if (receiverConfig === "set-to-undefined") {
    return undefined;
  }
  if (receiverConfig !== "not-set") {
    return receiverConfig;
  }

  if (devMode) {
    return new Receiver({ devMode });
  }

  if (bundle.hasSigningKeys) {
    return new Receiver({
      currentSigningKey: bundle.currentSigningKey,
      nextSigningKey: bundle.nextSigningKey,
      devMode,
    });
  }

  // if a signing key is set anywhere, requests are never accepted without verification
  return bundle.verificationRequired ? getRejectingReceiver(bundle) : undefined;
};

/**
 * Warns about the env variables which will make requests fail
 */
const warnAboutBundles = (bundles: CredentialBundle[]) => {
  const warnings = new Set<string>();

  for (const {
    prefix,
    usesRegionPrefix,
    url,
    hasToken,
    hasSigningKeys,
    verificationRequired,
  } of bundles) {
    if (verificationRequired && !hasSigningKeys) {
      const regions = bundles
        .filter((bundle) => bundle.prefix === prefix && bundle.region)
        .map((bundle) => bundle.region);
      warnings.add(
        `Requests${regions.length > 0 ? ` from ${regions.join(" and ")}` : ""} will be rejected. ` +
          `A QStash signing key is set, but ${prefix}QSTASH_CURRENT_SIGNING_KEY and ${prefix}QSTASH_NEXT_SIGNING_KEY are not both set.`
      );
    }
    if (usesRegionPrefix && hasToken && !url) {
      warnings.add(`${prefix}QSTASH_URL is not set. Using ${DEFAULT_QSTASH_URL}.`);
    }
  }

  for (const warning of warnings) {
    console.warn(`[Upstash Workflow] ${warning}`);
  }
};

const getQStashHandlers = ({
  environment,
  qstashClientOption,
  receiverConfig,
}: {
  environment: Record<string, string | undefined>;
  qstashClientOption?: QStashClientOption;
  receiverConfig: ReceiverConfig;
}): QStashHandlers => {
  const hasClientInstance = Boolean(qstashClientOption && "http" in qstashClientOption);
  // regions aren't used if a client is passed in options
  const defaultRegion = hasClientInstance ? undefined : getRegionFromEnvironment(environment);
  const devMode = isDevMode(environment, qstashClientOption);

  const createHandler = (region?: QStashRegion): RegionalHandler => {
    const bundle = readBundle(environment, region);
    return {
      bundle,
      client: getClient(bundle, qstashClientOption, devMode),
      receiver: getReceiver(bundle, receiverConfig, devMode),
      // the default region can be used without a token, like when QSTASH_REGION is not set.
      // Calls to QStash fail in that case.
      missingToken: !bundle.hasToken && !devMode && region !== defaultRegion,
    };
  };

  const qstashHandlers: QStashHandlers = defaultRegion
    ? {
        mode: "multi-region",
        defaultRegion,
        handlers: {
          US_EAST_1: createHandler("US_EAST_1"),
          EU_CENTRAL_1: createHandler("EU_CENTRAL_1"),
        },
      }
    : { mode: "single-region", handlers: createHandler() };

  if (receiverConfig === "not-set" && !devMode) {
    const handlers =
      qstashHandlers.mode === "multi-region"
        ? Object.values(qstashHandlers.handlers)
        : [qstashHandlers.handlers];
    warnAboutBundles(handlers.map((handler) => handler.bundle));
  }

  return qstashHandlers;
};

export const getQStashHandlerOptions = (
  ...params: Parameters<typeof getQStashHandlers>
): {
  qstashHandlers: QStashHandlers;
  defaultReceiver: WorkflowReceiver | undefined;
  defaultClient: WorkflowClient;
} => {
  const qstashHandlers = getQStashHandlers(...params);
  const { client, receiver } = getHandlersForRequest(qstashHandlers, null);

  return {
    qstashHandlers,
    defaultReceiver: receiver,
    defaultClient: client,
  };
};
