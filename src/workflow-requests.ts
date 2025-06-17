import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { WorkflowAbort, WorkflowError } from "./error";
import type { WorkflowContext } from "./context";
import {
  TELEMETRY_HEADER_FRAMEWORK,
  TELEMETRY_HEADER_RUNTIME,
  TELEMETRY_HEADER_SDK,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INVOKE_COUNT_HEADER,
} from "./constants";
import type {
  CallResponse,
  Step,
  StepType,
  Telemetry,
  WorkflowClient,
  WorkflowReceiver,
  WorkflowServeOptions,
} from "./types";
import { StepTypes } from "./types";
import type { WorkflowLogger } from "./logger";
import { FlowControl, PublishBatchRequest, PublishRequest, QstashError } from "@upstash/qstash";
import { getSteps } from "./client/utils";
import { getHeaders } from "./qstash/headers";
import { PublishToUrlResponse } from "@upstash/qstash";

type TriggerFirstInvocationParams<TInitialPayload> = {
  workflowContext: WorkflowContext<TInitialPayload>;
  useJSONContent?: boolean;
  telemetry?: Telemetry;
  debug?: WorkflowLogger;
  invokeCount?: number;
  delay?: PublishRequest["delay"];
};

export const triggerFirstInvocation = async <TInitialPayload>(
  params:
    | TriggerFirstInvocationParams<TInitialPayload>
    | TriggerFirstInvocationParams<TInitialPayload>[]
): Promise<Ok<"success" | "workflow-run-already-exists", never> | Err<never, Error>> => {
  const firstInvocationParams = Array.isArray(params) ? params : [params];
  const workflowContextClient = firstInvocationParams[0].workflowContext.qstashClient;

  const invocationBatch = firstInvocationParams.map(
    ({ workflowContext, useJSONContent, telemetry, invokeCount, delay }) => {
      const { headers } = getHeaders({
        initHeaderValue: "true",
        workflowConfig: {
          workflowRunId: workflowContext.workflowRunId,
          workflowUrl: workflowContext.url,
          failureUrl: workflowContext.failureUrl,
          retries: workflowContext.retries,
          telemetry: telemetry,
          flowControl: workflowContext.flowControl,
          useJSONContent: useJSONContent ?? false,
        },
        invokeCount: invokeCount ?? 0,
        userHeaders: workflowContext.headers,
      });

      // QStash doesn't forward content-type when passed in `upstash-forward-content-type`
      // so we need to pass it in the headers
      if (workflowContext.headers.get("content-type")) {
        headers["content-type"] = workflowContext.headers.get("content-type")!;
      }

      if (useJSONContent) {
        headers["content-type"] = "application/json";
      }

      const body =
        typeof workflowContext.requestPayload === "string"
          ? workflowContext.requestPayload
          : JSON.stringify(workflowContext.requestPayload);

      return {
        headers,
        method: "POST",
        body,
        url: workflowContext.url,
        delay: delay,
      } as PublishBatchRequest;
    }
  );

  try {
    const results = (await workflowContextClient.batch(invocationBatch)) as PublishToUrlResponse[];

    const invocationStatuses: ("success" | "workflow-run-already-exists")[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const invocationParams = firstInvocationParams[i];
      if (result.deduplicated) {
        await invocationParams.debug?.log("WARN", "SUBMIT_FIRST_INVOCATION", {
          message: `Workflow run ${invocationParams.workflowContext.workflowRunId} already exists. A new one isn't created.`,
          headers: invocationBatch[i].headers,
          requestPayload: invocationParams.workflowContext.requestPayload,
          url: invocationParams.workflowContext.url,
          messageId: result.messageId,
        });
        invocationStatuses.push("workflow-run-already-exists");
      } else {
        await invocationParams.debug?.log("SUBMIT", "SUBMIT_FIRST_INVOCATION", {
          headers: invocationBatch[i].headers,
          requestPayload: invocationParams.workflowContext.requestPayload,
          url: invocationParams.workflowContext.url,
          messageId: result.messageId,
        });
        invocationStatuses.push("success");
      }
    }

    const hasAnyDeduplicated = invocationStatuses.some(
      (status) => status === "workflow-run-already-exists"
    );

    if (hasAnyDeduplicated) {
      return ok("workflow-run-already-exists");
    } else {
      return ok("success");
    }
  } catch (error) {
    const error_ = error as Error;
    return err(error_);
  }
};

export const triggerRouteFunction = async ({
  onCleanup,
  onStep,
  onCancel,
  debug,
}: {
  onStep: () => Promise<unknown>;
  onCleanup: (result: unknown) => Promise<void>;
  onCancel: () => Promise<void>;
  debug?: WorkflowLogger;
}): Promise<
  | Ok<"workflow-finished" | "step-finished" | "workflow-was-finished" | "workflow-failed", never>
  | Err<never, Error>
> => {
  try {
    // When onStep completes successfully, it throws an exception named `WorkflowAbort`,
    // indicating that the step has been successfully executed.
    // This ensures that onCleanup is only called when no exception is thrown.
    const result = await onStep();
    await onCleanup(result);
    return ok("workflow-finished");
  } catch (error) {
    const error_ = error as Error;
    if (error instanceof QstashError && error.status === 400) {
      await debug?.log("WARN", "RESPONSE_WORKFLOW", {
        message: `tried to append to a cancelled workflow. exiting without publishing.`,
        name: error.name,
        errorMessage: error.message,
      });
      return ok("workflow-was-finished");
    } else if (!(error_ instanceof WorkflowAbort)) {
      return err(error_);
    } else if (error_.failWorkflow) {
      return ok("workflow-failed");
    } else if (error_.cancelWorkflow) {
      await onCancel();
      return ok("workflow-finished");
    } else {
      return ok("step-finished");
    }
  }
};

export const triggerWorkflowDelete = async <TInitialPayload>(
  workflowContext: WorkflowContext<TInitialPayload>,
  result: unknown,
  debug?: WorkflowLogger,
  cancel = false
): Promise<void> => {
  await debug?.log("SUBMIT", "SUBMIT_CLEANUP", {
    deletedWorkflowRunId: workflowContext.workflowRunId,
  });
  await workflowContext.qstashClient.http.request({
    path: ["v2", "workflows", "runs", `${workflowContext.workflowRunId}?cancel=${cancel}`],
    method: "DELETE",
    parseResponseAsJson: false,
    body: JSON.stringify(result),
  });
  await debug?.log(
    "SUBMIT",
    "SUBMIT_CLEANUP",
    `workflow run ${workflowContext.workflowRunId} deleted.`
  );
};

/**
 * Removes headers starting with `Upstash-Workflow-` from the headers
 *
 * @param headers incoming headers
 * @returns headers with `Upstash-Workflow-` headers removed
 */
export const recreateUserHeaders = (headers: Headers): Headers => {
  const filteredHeaders = new Headers();

  const pairs = headers.entries() as unknown as [string, string][];
  for (const [header, value] of pairs) {
    const headerLowerCase = header.toLowerCase();
    if (
      !headerLowerCase.startsWith("upstash-workflow-") &&
      // https://vercel.com/docs/edge-network/headers/request-headers#x-vercel-id
      !headerLowerCase.startsWith("x-vercel-") &&
      !headerLowerCase.startsWith("x-forwarded-") &&
      // https://blog.cloudflare.com/preventing-request-loops-using-cdn-loop/
      headerLowerCase !== "cf-connecting-ip" &&
      headerLowerCase !== "cdn-loop" &&
      headerLowerCase !== "cf-ew-via" &&
      headerLowerCase !== "cf-ray" &&
      // For Render https://render.com
      headerLowerCase !== "render-proxy-ttl"
    ) {
      filteredHeaders.append(header, value);
    }
  }

  return filteredHeaders as Headers;
};

/**
 * Checks if the request is from a third party call result. If so,
 * calls QStash to add the result to the ongoing workflow.
 *
 * Otherwise, does nothing.
 *
 * ### How third party calls work
 *
 * In third party calls, we publish a message to the third party API.
 * the result is then returned back to the workflow endpoint.
 *
 * Whenever the workflow endpoint receives a request, we first check
 * if the incoming request is a third party call result coming from QStash.
 * If so, we send back the result to QStash as a result step.
 *
 * @param request Incoming request
 * @param client QStash client
 * @returns
 */
export const handleThirdPartyCallResult = async ({
  request,
  requestPayload,
  client,
  workflowUrl,
  failureUrl,
  retries,
  telemetry,
  flowControl,
  debug,
}: {
  request: Request;
  requestPayload: string;
  client: WorkflowClient;
  workflowUrl: string;
  failureUrl: WorkflowServeOptions["failureUrl"];
  retries: number;
  telemetry?: Telemetry;
  flowControl?: FlowControl;
  debug?: WorkflowLogger;
}): Promise<
  | Ok<"is-call-return" | "continue-workflow" | "call-will-retry" | "workflow-ended", never>
  | Err<never, Error>
> => {
  try {
    if (request.headers.get("Upstash-Workflow-Callback")) {
      let callbackPayload: string;
      if (requestPayload) {
        callbackPayload = requestPayload;
      } else {
        const workflowRunId = request.headers.get("upstash-workflow-runid");
        const messageId = request.headers.get("upstash-message-id");

        if (!workflowRunId)
          throw new WorkflowError("workflow run id missing in context.call lazy fetch.");
        if (!messageId) throw new WorkflowError("message id missing in context.call lazy fetch.");

        const { steps, workflowRunEnded } = await getSteps(
          client.http,
          workflowRunId,
          messageId,
          debug
        );
        if (workflowRunEnded) {
          return ok("workflow-ended");
        }
        const failingStep = steps.find((step) => step.messageId === messageId);

        if (!failingStep)
          throw new WorkflowError(
            "Failed to submit the context.call. " +
              (steps.length === 0
                ? "No steps found."
                : `No step was found with matching messageId ${messageId} out of ${steps.length} steps.`)
          );

        callbackPayload = atob(failingStep.body);
      }

      const callbackMessage = JSON.parse(callbackPayload) as {
        status: number;
        body?: string;
        retried?: number; // only set after the first try
        maxRetries: number;
        header: Record<string, string[]>;
      };

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      if (
        !(callbackMessage.status >= 200 && callbackMessage.status < 300) &&
        callbackMessage.maxRetries &&
        callbackMessage.retried !== callbackMessage.maxRetries
      ) {
        await debug?.log("WARN", "SUBMIT_THIRD_PARTY_RESULT", {
          status: callbackMessage.status,
          body: atob(callbackMessage.body ?? ""),
        });
        // this callback will be retried by the QStash, we just ignore it
        console.warn(
          `Workflow Warning: "context.call" failed with status ${callbackMessage.status}` +
            ` and will retry (retried ${callbackMessage.retried ?? 0} out of ${callbackMessage.maxRetries} times).` +
            ` Error Message:\n${atob(callbackMessage.body ?? "")}`
        );
        return ok("call-will-retry");
      }

      const workflowRunId = request.headers.get(WORKFLOW_ID_HEADER);
      const stepIdString = request.headers.get("Upstash-Workflow-StepId");
      const stepName = request.headers.get("Upstash-Workflow-StepName");
      const stepType = request.headers.get("Upstash-Workflow-StepType") as StepType;
      const concurrentString = request.headers.get("Upstash-Workflow-Concurrent");
      const contentType = request.headers.get("Upstash-Workflow-ContentType");
      const invokeCount = request.headers.get(WORKFLOW_INVOKE_COUNT_HEADER);

      if (
        !(
          (
            workflowRunId &&
            stepIdString &&
            stepName &&
            StepTypes.includes(stepType) &&
            concurrentString &&
            contentType
          )
          // not adding invokeCount to required for backwards compatibility.
        )
      ) {
        throw new Error(
          `Missing info in callback message source header: ${JSON.stringify({
            workflowRunId,
            stepIdString,
            stepName,
            stepType,
            concurrentString,
            contentType,
          })}`
        );
      }

      const userHeaders = recreateUserHeaders(request.headers as Headers);
      const { headers: requestHeaders } = getHeaders({
        initHeaderValue: "false",
        workflowConfig: {
          workflowRunId,
          workflowUrl,
          failureUrl,
          retries,
          telemetry,
          flowControl,
        },
        userHeaders,
        invokeCount: Number(invokeCount),
      });

      const callResponse: CallResponse = {
        status: callbackMessage.status,
        body: atob(callbackMessage.body ?? ""),
        header: callbackMessage.header,
      };
      const callResultStep: Step<string> = {
        stepId: Number(stepIdString),
        stepName,
        stepType,
        out: JSON.stringify(callResponse),
        concurrent: Number(concurrentString),
      };

      await debug?.log("SUBMIT", "SUBMIT_THIRD_PARTY_RESULT", {
        step: callResultStep,
        headers: requestHeaders,
        url: workflowUrl,
      });

      const result = await client.publishJSON({
        headers: requestHeaders,
        method: "POST",
        body: callResultStep,
        url: workflowUrl,
      });

      await debug?.log("SUBMIT", "SUBMIT_THIRD_PARTY_RESULT", {
        messageId: result.messageId,
      });

      return ok("is-call-return");
    } else {
      return ok("continue-workflow");
    }
  } catch (error) {
    const isCallReturn = request.headers.get("Upstash-Workflow-Callback");
    return err(
      new WorkflowError(`Error when handling call return (isCallReturn=${isCallReturn}): ${error}`)
    );
  }
};

export type HeadersResponse = {
  headers: Record<string, string>;
  contentType: string;
};

export const getTelemetryHeaders = (telemetry: Telemetry) => {
  return {
    [TELEMETRY_HEADER_SDK]: telemetry.sdk,
    [TELEMETRY_HEADER_FRAMEWORK]: telemetry.framework,
    [TELEMETRY_HEADER_RUNTIME]: telemetry.runtime ?? "unknown",
  };
};

export const verifyRequest = async (
  body: string,
  signature: string | null,
  verifier?: WorkflowReceiver
) => {
  if (!verifier) {
    return;
  }

  try {
    if (!signature) {
      throw new Error("`Upstash-Signature` header is not passed.");
    }
    const isValid = await verifier.verify({
      body,
      signature,
    });
    if (!isValid) {
      throw new Error("Signature in `Upstash-Signature` header is not valid");
    }
  } catch (error) {
    throw new WorkflowError(
      `Failed to verify that the Workflow request comes from QStash: ${error}\n\n` +
        "If signature is missing, trigger the workflow endpoint by publishing your request to QStash instead of calling it directly.\n\n" +
        "If you want to disable QStash Verification, you should clear env variables QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY"
    );
  }
};
