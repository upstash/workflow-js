import { Receiver } from "@upstash/qstash";
import { Client } from "@upstash/qstash";
import { WORKFLOW_PROTOCOL_VERSION, WORKFLOW_PROTOCOL_VERSION_HEADER } from "../constants";
import type { DetailedFinishCondition, RequiredExceptFields, WorkflowServeOptions } from "../types";
import { formatWorkflowError, WorkflowError } from "../error";
import { loggingMiddleware } from "../middleware";
import { DispatchDebug } from "../middleware/types";

export type ResponseData = {
  text: string;
  status: number;
  headers: Record<string, string>;
};

/**
 * Internal options for serveBase that are not exposed to users
 */
export type InternalServeOptions<TResponse extends Response = Response> = {
  /**
   * Function to generate a Response from ResponseData
   */
  generateResponse: (responseData: ResponseData) => TResponse;
  /**
   * Whether the framework should use `content-type: application/json`
   * in `triggerFirstInvocation`.
   */
  useJSONContent: boolean;
};

/**
 * Creates response data based on workflow run ID and finish condition.
 * This is an internal method that cannot be overwritten by users.
 *
 * @param workflowRunId - The ID of the workflow run
 * @param detailedFinishCondition - The detailed finish condition
 * @returns Response data with text, status, and headers
 */
export const createResponseData = (
  workflowRunId: string,
  detailedFinishCondition: DetailedFinishCondition
): ResponseData => {
  const baseHeaders = {
    [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
  };

  if (detailedFinishCondition?.condition === "auth-fail") {
    return {
      text: JSON.stringify({
        message: AUTH_FAIL_MESSAGE,
        workflowRunId,
      }),
      status: 400,
      headers: baseHeaders,
    };
  } else if (detailedFinishCondition?.condition === "non-retryable-error") {
    return {
      text: JSON.stringify(formatWorkflowError(detailedFinishCondition.result)),
      status: 489,
      headers: {
        ...baseHeaders,
        "Upstash-NonRetryable-Error": "true",
      },
    };
  } else if (detailedFinishCondition?.condition === "retry-after-error") {
    return {
      text: JSON.stringify(formatWorkflowError(detailedFinishCondition.result)),
      status: 429,
      headers: {
        ...baseHeaders,
        "Retry-After": detailedFinishCondition.result.retryAfter.toString(),
      },
    };
  } else if (detailedFinishCondition?.condition === "failure-callback-executed") {
    return {
      text: JSON.stringify({ result: detailedFinishCondition.result ?? undefined }),
      status: 200,
      headers: baseHeaders,
    };
  } else if (detailedFinishCondition?.condition === "failure-callback-undefined") {
    return {
      text: JSON.stringify({
        workflowRunId,
        finishCondition: detailedFinishCondition.condition,
      }),
      status: 200,
      headers: {
        ...baseHeaders,
        "Upstash-Workflow-Failure-Callback-Notfound": "true",
      },
    };
  }

  return {
    text: JSON.stringify({
      workflowRunId,
      finishCondition: detailedFinishCondition.condition,
    }),
    status: 200,
    headers: baseHeaders,
  };
};

/**
 * Fills the options with default values if they are not provided.
 *
 * Default values for:
 * - qstashClient: QStash client created with QSTASH_URL and QSTASH_TOKEN env vars
 * - initialPayloadParser: calls JSON.parse if initial request body exists.
 * - receiver: a Receiver if the required env vars are set
 * - baseUrl: env variable UPSTASH_WORKFLOW_URL
 *
 * @param options options including the client and initialPayloadParser
 * @returns
 */
export const processOptions = <
  TInitialPayload = unknown,
  TResult = unknown,
  TResponse extends Response = Response,
>(
  options?: WorkflowServeOptions<TInitialPayload, TResult>,
  internalOptions?: Partial<InternalServeOptions<TResponse>>
): RequiredExceptFields<
  WorkflowServeOptions<TInitialPayload, TResult>,
  "receiver" | "url" | "failureFunction" | "baseUrl" | "schema" | "middlewares" | "verbose"
> & { internal: InternalServeOptions<TResponse> } => {
  const environment =
    options?.env ?? (typeof process === "undefined" ? ({} as Record<string, string>) : process.env);

  const receiverEnvironmentVariablesSet = Boolean(
    environment.QSTASH_CURRENT_SIGNING_KEY && environment.QSTASH_NEXT_SIGNING_KEY
  );

  return {
    qstashClient:
      options?.qstashClient ??
      new Client({
        baseUrl: environment.QSTASH_URL!,
        token: environment.QSTASH_TOKEN!,
      }),
    initialPayloadParser: (initialRequest: string) => {
      // if there is no payload, simply return undefined
      if (!initialRequest) {
        return undefined as TInitialPayload;
      }

      // try to parse the payload
      try {
        const parsed = JSON.parse(initialRequest) as TInitialPayload;
        return options?.schema ? options.schema.parse(parsed) : parsed;
      } catch (error) {
        // if you get an error when parsing, return it as it is
        // needed in plain string case.
        if (error instanceof SyntaxError) {
          return initialRequest as TInitialPayload;
        }
        // if not JSON.parse error, throw error
        throw error;
      }
    },
    receiver: receiverEnvironmentVariablesSet
      ? new Receiver({
          currentSigningKey: environment.QSTASH_CURRENT_SIGNING_KEY!,
          nextSigningKey: environment.QSTASH_NEXT_SIGNING_KEY!,
        })
      : undefined,
    baseUrl: environment.UPSTASH_WORKFLOW_URL,
    env: environment,
    disableTelemetry: false,
    ...options,
    // merge middlewares
    middlewares: [options?.middlewares ?? [], options?.verbose ? [loggingMiddleware] : []].flat(),
    internal: {
      generateResponse:
        internalOptions?.generateResponse ??
        ((responseData: ResponseData) => {
          return new Response(responseData.text, {
            status: responseData.status,
            headers: responseData.headers,
          }) as TResponse;
        }),
      useJSONContent: internalOptions?.useJSONContent ?? false,
    },
  };
};

/**
 * Determines the workflow and failure url based on the passed parameters.
 *
 * throws error if the url doesn't start with http:// or https://.
 *
 * @param request request. used to retrieve the request.url
 * @param url user passed url (which also has the full route)
 * @param baseUrl UPSTASH_WORKFLOW_URL env var or the user passed baseUrl. Used to replace
 *    the beginning of the final URLs before returning.
 * @param dispatchDebug debug event dispatcher
 * @returns workflow URL and failure URL
 */
export const determineUrls = async (
  request: Request,
  url: string | undefined,
  baseUrl: string | undefined,
  dispatchDebug: DispatchDebug
) => {
  const initialWorkflowUrl = url ?? request.url;
  const workflowUrl = baseUrl
    ? initialWorkflowUrl.replace(/^(https?:\/\/[^/]+)(\/.*)?$/, (_, matchedBaseUrl, path) => {
        return baseUrl + ((path as string) || "");
      })
    : initialWorkflowUrl;

  if (workflowUrl !== initialWorkflowUrl) {
    await dispatchDebug("onInfo", {
      info: `The workflow URL's base URL has been replaced with the provided baseUrl. Original URL: ${initialWorkflowUrl}, New URL: ${workflowUrl}`,
    });
  }

  if (workflowUrl.includes("localhost")) {
    await dispatchDebug("onInfo", {
      info: `Workflow URL contains localhost. This can happen in local development, but shouldn't happen in production unless you have a route which contains localhost. Received: ${workflowUrl}`,
    });
  }

  if (!(workflowUrl.startsWith("http://") || workflowUrl.startsWith("https://"))) {
    throw new WorkflowError(
      `Workflow URL should start with 'http://' or 'https://'. Recevied is '${workflowUrl}'`
    );
  }

  return {
    workflowUrl,
  };
};

export const AUTH_FAIL_MESSAGE = `Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run`;
