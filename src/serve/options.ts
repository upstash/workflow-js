import { Receiver } from "@upstash/qstash";
import { Client } from "@upstash/qstash";
import { DEFAULT_RETRIES } from "../constants";
import type { FinishCondition, RequiredExceptFields, WorkflowServeOptions } from "../types";
import { WorkflowLogger } from "../logger";

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
  "verbose" | "receiver" | "url" | "failureFunction" | "failureUrl" | "baseUrl"
> => {
  const environment =
    options?.env ?? (typeof process === "undefined" ? ({} as Record<string, string>) : process.env);

  const receiverEnvironmentVariablesSet = Boolean(
    environment.QSTASH_CURRENT_SIGNING_KEY && environment.QSTASH_NEXT_SIGNING_KEY
  );

  return {
    qstashClient: new Client({
      baseUrl: environment.QSTASH_URL!,
      token: environment.QSTASH_TOKEN!,
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onStepFinish: (workflowRunId: string, _finishCondition: FinishCondition) =>
      new Response(JSON.stringify({ workflowRunId }), {
        status: 200,
      }) as TResponse,
    initialPayloadParser: (initialRequest: string) => {
      // if there is no payload, simply return undefined
      if (!initialRequest) {
        return undefined as TInitialPayload;
      }

      // try to parse the payload
      try {
        return JSON.parse(initialRequest) as TInitialPayload;
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
    ...options,
  };
};

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

  return {
    workflowUrl,
    workflowFailureUrl,
  };
};
