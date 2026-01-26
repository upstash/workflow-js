import { Client, Receiver } from "@upstash/qstash";
import {
  getRegionFromEnvironment,
  normalizeRegionHeader,
  QStashHandlers,
  QStashRegion,
  readClientEnvironmentVariables,
  readReceiverEnvironmentVariables,
  RegionalHandler,
} from "./utils";
import { QStashClientExtraConfig, WorkflowClient, WorkflowReceiver } from "../../types";

/**
 * Get the appropriate QStash client and receiver based on the request region header
 *
 * @param qstashHandlers - The QStash handlers configuration
 * @param regionHeader - The UPSTASH-REGION header from the request
 * @param isFirstInvocation - Whether this is the first invocation
 * @returns Regional handler with client and receiver
 */
export const getHandlersForRequest = (
  qstashHandlers: QStashHandlers,
  regionHeader: string | null,
  isFirstInvocation: boolean
): RegionalHandler => {
  if (qstashHandlers.mode === "single-region") {
    return qstashHandlers.handlers;
  }

  // Multi-region mode
  let targetRegion: QStashRegion;

  if (isFirstInvocation && !regionHeader) {
    // Use the default region for first non-qstash invocation
    targetRegion = qstashHandlers.defaultRegion;
  } else {
    // Use the region from the header for subsequent invocations
    const normalizedRegion = regionHeader ? normalizeRegionHeader(regionHeader) : undefined;
    targetRegion = normalizedRegion ?? qstashHandlers.defaultRegion;
  }

  const handler = qstashHandlers.handlers[targetRegion];

  if (!handler) {
    console.warn(
      `[Upstash Workflow] No handler found for region "${targetRegion}". Falling back to default region.`
    );
    return qstashHandlers.handlers[qstashHandlers.defaultRegion];
  }

  return handler;
};

/**
 * Creates a regional handler with client and receiver
 */
const createRegionalHandler = (
  environment: Record<string, string | undefined>,
  receiverConfig: WorkflowReceiver | "set-to-undefined" | "not-set",
  region?: QStashRegion,
  clientOptions?: Omit<ConstructorParameters<typeof Client>[0], "baseUrl" | "token">
): RegionalHandler => {
  const clientEnv = readClientEnvironmentVariables(environment, region);

  const client = new Client({
    ...clientOptions,
    baseUrl: clientEnv.QSTASH_URL!,
    token: clientEnv.QSTASH_TOKEN!,
  });
  const receiver = getReceiver(environment, receiverConfig, region);

  return { client, receiver };
};

/**
 * Determines if multi-region mode should be enabled
 */
const shouldUseMultiRegionMode = (
  environment: Record<string, string | undefined>,
  qstashClientOption?: WorkflowClient | QStashClientExtraConfig
):
  | { isMultiRegion: true; defaultRegion: QStashRegion; clientOptions?: QStashClientExtraConfig }
  | { isMultiRegion: false } => {
  // Multi-region mode is enabled when:
  // 1. QSTASH_REGION env variable is set
  // 2. qstashClient option is not a WorkflowClient instance (either undefined or config object)
  const hasRegionEnv = Boolean(getRegionFromEnvironment(environment));
  if (hasRegionEnv && (!qstashClientOption || !("http" in qstashClientOption))) {
    return {
      isMultiRegion: true,
      defaultRegion: getRegionFromEnvironment(environment)!,
      clientOptions: qstashClientOption,
    };
  } else {
    return { isMultiRegion: false };
  }
};

const getQStashHandlers = ({
  environment,
  qstashClientOption,
  receiverConfig,
}: {
  environment: Record<string, string | undefined>;
  qstashClientOption?: WorkflowClient | QStashClientExtraConfig;
  /**
   * - "set-to-undefined" if user explicitly set receiver to undefined in options
   * - "not-set" if user did not pass receiver in options
   * - WorkflowReceiver if user passed a receiver instance in options
   */
  receiverConfig: WorkflowReceiver | "set-to-undefined" | "not-set";
}): QStashHandlers => {
  const multiRegion = shouldUseMultiRegionMode(environment, qstashClientOption);

  if (multiRegion.isMultiRegion) {
    // Multi-region mode

    const regions: QStashRegion[] = ["US_EAST_1", "EU_CENTRAL_1"];
    const handlers: Record<QStashRegion, RegionalHandler> = {} as Record<
      QStashRegion,
      RegionalHandler
    >;

    for (const region of regions) {
      try {
        handlers[region] = createRegionalHandler(
          environment,
          receiverConfig,
          region,
          multiRegion.clientOptions
        );
      } catch (error) {
        console.warn(`[Upstash Workflow] Failed to create handler for region ${region}:`, error);
      }
    }

    return {
      mode: "multi-region",
      handlers,
      defaultRegion: multiRegion.defaultRegion,
    };
  } else {
    // Single-region mode
    return {
      mode: "single-region",
      handlers: {
        client:
          qstashClientOption && "http" in qstashClientOption
            ? qstashClientOption
            : new Client({
                ...qstashClientOption,
                baseUrl: environment.QSTASH_URL!,
                token: environment.QSTASH_TOKEN!,
              }),
        receiver: getReceiver(environment, receiverConfig),
      },
    };
  }
};

const getReceiver = (
  environment: Record<string, string | undefined>,
  receiverConfig: WorkflowReceiver | "set-to-undefined" | "not-set",
  region?: QStashRegion
) => {
  if (typeof receiverConfig === "string") {
    if (receiverConfig === "set-to-undefined") {
      return undefined;
    }

    const receiverEnv = readReceiverEnvironmentVariables(environment, region);
    return receiverEnv.QSTASH_CURRENT_SIGNING_KEY && receiverEnv.QSTASH_NEXT_SIGNING_KEY
      ? new Receiver({
          currentSigningKey: receiverEnv.QSTASH_CURRENT_SIGNING_KEY,
          nextSigningKey: receiverEnv.QSTASH_NEXT_SIGNING_KEY,
        })
      : undefined;
  } else {
    return receiverConfig;
  }
};

export const getQStashHandlerOptions = (
  ...params: Parameters<typeof getQStashHandlers>
): {
  qstashHandlers: ReturnType<typeof getQStashHandlers>;
  defaultReceiver: WorkflowReceiver | undefined;
  defaultClient: WorkflowClient;
} => {
  const handlers = getQStashHandlers(...params);

  return {
    qstashHandlers: handlers,
    defaultReceiver:
      handlers.mode === "single-region"
        ? handlers.handlers.receiver
        : handlers.handlers[handlers.defaultRegion].receiver,
    defaultClient:
      handlers.mode === "single-region"
        ? handlers.handlers.client
        : handlers.handlers[handlers.defaultRegion].client,
  };
};
