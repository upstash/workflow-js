import { Client, Receiver } from "@upstash/qstash";
import {
  CredentialBundle,
  DEFAULT_QSTASH_URL,
  getBundlePrefix,
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
 *
 * Throws if the requests of the region can't be handled.
 */
export const getHandlersForRequest = (
  qstashHandlers: QStashHandlers,
  regionHeader: string | null
): RegionalHandler => {
  const handler =
    qstashHandlers.mode === "single-region"
      ? qstashHandlers.handlers
      : qstashHandlers.handlers[
          normalizeRegionHeader(regionHeader ?? undefined) ?? qstashHandlers.defaultRegion
        ];

  if (handler.error) {
    throw new WorkflowError(handler.error);
  }

  return handler;
};

/**
 * Handler of the region in QSTASH_REGION, or the only handler if it's not set
 */
const getDefaultHandler = (qstashHandlers: QStashHandlers): RegionalHandler =>
  qstashHandlers.mode === "single-region"
    ? qstashHandlers.handlers
    : qstashHandlers.handlers[qstashHandlers.defaultRegion];

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
    baseUrl: bundle.credentials.url ?? DEFAULT_QSTASH_URL,
    token: bundle.credentials.token,
    devMode,
  });
};

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

  return bundle.verification === "verify"
    ? new Receiver({
        currentSigningKey: bundle.credentials.currentSigningKey,
        nextSigningKey: bundle.credentials.nextSigningKey,
        devMode,
      })
    : undefined;
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
    const prefix = getBundlePrefix(bundle);
    const handler: RegionalHandler = {
      client: getClient(bundle, qstashClientOption, devMode),
      receiver: getReceiver(bundle, receiverConfig, devMode),
    };

    if (devMode) {
      return handler;
    }

    if (bundle.usesRegionPrefix && bundle.credentials.token && !bundle.credentials.url) {
      console.warn(
        `[Upstash Workflow] ${prefix}QSTASH_URL is not set. Using ${DEFAULT_QSTASH_URL}.`
      );
    }

    // Signing keys are read from env variables if receiver isn't passed in
    // options. Requests are never accepted without verification if a signing
    // key is set somewhere.
    if (receiverConfig === "not-set" && bundle.verification === "reject") {
      const error = `Requests${region ? ` from ${region}` : ""} are rejected. A QStash signing key is set, but ${prefix}QSTASH_CURRENT_SIGNING_KEY and ${prefix}QSTASH_NEXT_SIGNING_KEY are not both set.`;
      console.warn(`[Upstash Workflow] ${error}`);
      return { ...handler, error };
    }

    // The default region can be used without a token, like when QSTASH_REGION
    // is not set. Calls to QStash fail in that case.
    if (!bundle.credentials.token && region !== defaultRegion) {
      return {
        ...handler,
        error: `Received a request for region ${region}, but ${prefix}QSTASH_TOKEN is not set.`,
      };
    }

    return handler;
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
  const { client, receiver } = getDefaultHandler(qstashHandlers);

  return {
    qstashHandlers,
    defaultReceiver: receiver,
    defaultClient: client,
  };
};
