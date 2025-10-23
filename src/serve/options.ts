import { Receiver } from "@upstash/qstash";
import { Client } from "@upstash/qstash";
import {
  DEFAULT_RETRIES,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "../constants";
import type { RequiredExceptFields, WorkflowServeOptions } from "../types";
import { WorkflowLogger } from "../logger";
import { formatWorkflowError, WorkflowError } from "../error";

/**
 * Fills the options with default values if they are not provided.
 *
 * Default values for:
 * - qstashClient: QStash client created with QSTASH_URL and QSTASH_TOKEN env vars
 * - onStepFinish: returns a Response with workflowRunId & finish condition in the body (status: 200)
 * - initialPayloadParser: calls JSON.parse if initial request body exists.
 * - receiver: a Receiver if the required env vars are set
 * - baseUrl: env variable UPSTASH_WORKFLOW_URL
 *
 * @param options options including the client, onFinish and initialPayloadParser
 * @returns
 */
export const processOptions = <TResponse extends Response = Response, TInitialPayload = unknown>(
  options?: WorkflowServeOptions<TResponse, TInitialPayload>
): RequiredExceptFields<
  WorkflowServeOptions<TResponse, TInitialPayload>,
  | "verbose"
  | "receiver"
  | "url"
  | "failureFunction"
  | "failureUrl"
  | "baseUrl"
  | "schema"
  | "flowControl"
  | "retryDelay"
> => {
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
    onStepFinish: (workflowRunId, _finishCondition, detailedFinishCondition) => {
      if (detailedFinishCondition?.condition === "auth-fail") {
        console.error(AUTH_FAIL_MESSAGE);
        return new Response(
          JSON.stringify({
            message: AUTH_FAIL_MESSAGE,
            workflowRunId,
          }),
          {
            status: 400,
            headers: {
              [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            },
          }
        ) as TResponse;
      } else if (detailedFinishCondition?.condition === "non-retryable-error") {

        console.log("RETURNING 489");
        return new Response(JSON.stringify(formatWorkflowError(detailedFinishCondition.result)), {
          headers: {
            "Upstash-NonRetryable-Error": "true",
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          },
          status: 489,
        }) as TResponse;
      } else if (detailedFinishCondition?.condition === "failure-callback") {
        return new Response(detailedFinishCondition.result ?? undefined, {
          status: 200,
          headers: {
            [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
          },
        }) as TResponse;
      }
      return new Response(JSON.stringify({ workflowRunId }), {
        status: 200,
        headers: {
          [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
        },
      }) as TResponse;
    },
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
    retries: DEFAULT_RETRIES,
    useJSONContent: false,
    disableTelemetry: false,
    onError: console.error,
    ...options,
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
 * @param failureFunction failureFunction. failureUrl will be workflow url if set.
 * @param failureUrl used as failureUrl if failureFunction isn't passed.
 * @param debug logger
 * @returns
 */
export const determineUrls = async <TInitialPayload = unknown>(
  request: Request,
  url: string | undefined,
  baseUrl: string | undefined,
  failureFunction: WorkflowServeOptions<Response, TInitialPayload>["failureFunction"],
  failureUrl: string | undefined,
  debug: WorkflowLogger | undefined
) => {
  const initialWorkflowUrl = url ?? request.url;
  const workflowUrl = baseUrl
    ? initialWorkflowUrl.replace(/^(https?:\/\/[^/]+)(\/.*)?$/, (_, matchedBaseUrl, path) => {
        return baseUrl + ((path as string) || "");
      })
    : initialWorkflowUrl;

  // log workflow url change
  if (workflowUrl !== initialWorkflowUrl) {
    await debug?.log("WARN", "ENDPOINT_START", {
      warning: `Upstash Workflow: replacing the base of the url with "${baseUrl}" and using it as workflow endpoint.`,
      originalURL: initialWorkflowUrl,
      updatedURL: workflowUrl,
    });
  }

  // set url to call in case of failure
  const workflowFailureUrl = failureFunction ? workflowUrl : failureUrl;

  if (workflowUrl.includes("localhost")) {
    await debug?.log("WARN", "ENDPOINT_START", {
      message: `Workflow URL contains localhost. This can happen in local development, but shouldn't happen in production unless you have a route which contains localhost. Received: ${workflowUrl}`,
    });
  }

  if (!(workflowUrl.startsWith("http://") || workflowUrl.startsWith("https://"))) {
    throw new WorkflowError(
      `Workflow URL should start with 'http://' or 'https://'. Recevied is '${workflowUrl}'`
    );
  }

  return {
    workflowUrl,
    workflowFailureUrl,
  };
};

export const AUTH_FAIL_MESSAGE = `Failed to authenticate Workflow request. If this is unexpected, see the caveat https://upstash.com/docs/workflow/basics/caveats#avoid-non-deterministic-code-outside-context-run`;
