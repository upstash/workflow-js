import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { WorkflowAbort, WorkflowError } from "./error";
import type { WorkflowContext } from "./context";
import {
  DEFAULT_CONTENT_TYPE,
  TELEMETRY_HEADER_FRAMEWORK,
  TELEMETRY_HEADER_RUNTIME,
  TELEMETRY_HEADER_SDK,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_FEATURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_INIT_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_URL_HEADER,
} from "./constants";
import type {
  CallResponse,
  HeaderParams,
  Step,
  StepType,
  Telemetry,
  WorkflowClient,
  WorkflowReceiver,
  WorkflowServeOptions,
} from "./types";
import { StepTypes } from "./types";
import type { WorkflowLogger } from "./logger";
import { FlowControl, QstashError } from "@upstash/qstash";
import { getSteps } from "./client/utils";

export const triggerFirstInvocation = async <TInitialPayload>({
  workflowContext,
  useJSONContent,
  telemetry,
  debug,
}: {
  workflowContext: WorkflowContext<TInitialPayload>;
  useJSONContent?: boolean;
  telemetry?: Telemetry;
  debug?: WorkflowLogger;
}): Promise<Ok<"success" | "workflow-run-already-exists", never> | Err<never, Error>> => {
  const { headers } = getHeaders({
    initHeaderValue: "true",
    workflowRunId: workflowContext.workflowRunId,
    workflowUrl: workflowContext.url,
    userHeaders: workflowContext.headers,
    failureUrl: workflowContext.failureUrl,
    retries: workflowContext.retries,
    telemetry,
  });

  if (useJSONContent) {
    headers["content-type"] = "application/json";
  }

  try {
    const body =
      typeof workflowContext.requestPayload === "string"
        ? workflowContext.requestPayload
        : JSON.stringify(workflowContext.requestPayload);
    const result = await workflowContext.qstashClient.publish({
      headers,
      method: "POST",
      body,
      url: workflowContext.url,
      flowControl: workflowContext.flowControl
    });

    if (result.deduplicated) {
      await debug?.log("WARN", "SUBMIT_FIRST_INVOCATION", {
        message: `Workflow run ${workflowContext.workflowRunId} already exists. A new one isn't created.`,
        headers,
        requestPayload: workflowContext.requestPayload,
        url: workflowContext.url,
        messageId: result.messageId,
      });
      return ok("workflow-run-already-exists");
    } else {
      await debug?.log("SUBMIT", "SUBMIT_FIRST_INVOCATION", {
        headers,
        requestPayload: workflowContext.requestPayload,
        url: workflowContext.url,
        messageId: result.messageId,
      });
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
  onStep: () => Promise<void>;
  onCleanup: () => Promise<void>;
  onCancel: () => Promise<void>;
  debug?: WorkflowLogger;
}): Promise<
  Ok<"workflow-finished" | "step-finished" | "workflow-was-finished", never> | Err<never, Error>
> => {
  try {
    // When onStep completes successfully, it throws an exception named `WorkflowAbort`,
    // indicating that the step has been successfully executed.
    // This ensures that onCleanup is only called when no exception is thrown.
    await onStep();
    await onCleanup();
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

      if (
        !(
          workflowRunId &&
          stepIdString &&
          stepName &&
          StepTypes.includes(stepType) &&
          concurrentString &&
          contentType
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
        workflowRunId,
        workflowUrl,
        userHeaders,
        failureUrl,
        retries,
        telemetry,
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
        flowControl
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
  timeoutHeaders?: Record<string, string[]>;
};

export const getTelemetryHeaders = (telemetry: Telemetry) => {
  return {
    [TELEMETRY_HEADER_SDK]: telemetry.sdk,
    [TELEMETRY_HEADER_FRAMEWORK]: telemetry.framework,
    [TELEMETRY_HEADER_RUNTIME]: telemetry.runtime ?? "unknown",
  };
};

/**
 * Gets headers for calling QStash
 *
 * See HeaderParams for more details about parameters.
 *
 * @returns headers to submit
 */
export const getHeaders = ({
  initHeaderValue,
  workflowRunId,
  workflowUrl,
  userHeaders,
  failureUrl,
  retries,
  step,
  callRetries,
  callTimeout,
  telemetry,
}: HeaderParams): HeadersResponse => {
  const baseHeaders: Record<string, string> = {
    [WORKFLOW_INIT_HEADER]: initHeaderValue,
    [WORKFLOW_ID_HEADER]: workflowRunId,
    [WORKFLOW_URL_HEADER]: workflowUrl,
    [WORKFLOW_FEATURE_HEADER]: "LazyFetch,InitialBody",
    ...(telemetry ? getTelemetryHeaders(telemetry) : {}),
  };

  if (!step?.callUrl) {
    baseHeaders[`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`] = WORKFLOW_PROTOCOL_VERSION;
  }
  if (callTimeout) {
    baseHeaders[`Upstash-Timeout`] = callTimeout.toString();
  }

  if (failureUrl) {
    baseHeaders[`Upstash-Failure-Callback-Forward-${WORKFLOW_FAILURE_HEADER}`] = "true";
    if (!step?.callUrl) {
      baseHeaders["Upstash-Failure-Callback"] = failureUrl;
    }
  }

  // if retries is set or if call url is passed, set a retry
  // for call url, retry is 0
  if (step?.callUrl) {
    baseHeaders["Upstash-Retries"] = callRetries?.toString() ?? "0";
    baseHeaders[WORKFLOW_FEATURE_HEADER] = "WF_NoDelete,InitialBody";

    // if some retries is set, use it in callback and failure callback
    if (retries !== undefined) {
      baseHeaders["Upstash-Callback-Retries"] = retries.toString();
      baseHeaders["Upstash-Failure-Callback-Retries"] = retries.toString();
    }
  } else if (retries !== undefined) {
    baseHeaders["Upstash-Retries"] = retries.toString();
    baseHeaders["Upstash-Failure-Callback-Retries"] = retries.toString();
  }

  if (userHeaders) {
    for (const header of userHeaders.keys()) {
      if (step?.callHeaders) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        baseHeaders[`Upstash-Callback-Forward-${header}`] = userHeaders.get(header)!;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        baseHeaders[`Upstash-Forward-${header}`] = userHeaders.get(header)!;
      }
      baseHeaders[`Upstash-Failure-Callback-Forward-${header}`] = userHeaders.get(header)!;
    }
  }

  const contentType =
    (userHeaders ? userHeaders.get("Content-Type") : undefined) ?? DEFAULT_CONTENT_TYPE;

  if (step?.callHeaders) {
    const forwardedHeaders = Object.fromEntries(
      Object.entries(step.callHeaders).map(([header, value]) => [
        `Upstash-Forward-${header}`,
        value,
      ])
    );

    return {
      headers: {
        ...baseHeaders,
        ...forwardedHeaders,
        "Upstash-Callback": workflowUrl,
        "Upstash-Callback-Workflow-RunId": workflowRunId,
        "Upstash-Callback-Workflow-CallType": "fromCallback",
        "Upstash-Callback-Workflow-Init": "false",
        "Upstash-Callback-Workflow-Url": workflowUrl,
        "Upstash-Callback-Feature-Set": "LazyFetch,InitialBody",

        "Upstash-Callback-Forward-Upstash-Workflow-Callback": "true",
        "Upstash-Callback-Forward-Upstash-Workflow-StepId": step.stepId.toString(),
        "Upstash-Callback-Forward-Upstash-Workflow-StepName": step.stepName,
        "Upstash-Callback-Forward-Upstash-Workflow-StepType": step.stepType,
        "Upstash-Callback-Forward-Upstash-Workflow-Concurrent": step.concurrent.toString(),
        "Upstash-Callback-Forward-Upstash-Workflow-ContentType": contentType,
        "Upstash-Workflow-CallType": "toCallback",
      },
    };
  }

  if (step?.waitEventId) {
    return {
      headers: {
        ...baseHeaders,
        "Upstash-Workflow-CallType": "step",
      },
      timeoutHeaders: {
        // to include user headers:
        ...Object.fromEntries(
          Object.entries(baseHeaders).map(([header, value]) => [header, [value]])
        ),
        // to include telemetry headers:
        ...(telemetry
          ? Object.fromEntries(
            Object.entries(getTelemetryHeaders(telemetry)).map(([header, value]) => [
              header,
              [value],
            ])
          )
          : {}),
        // note: using WORKFLOW_ID_HEADER doesn't work, because Runid -> RunId:
        "Upstash-Workflow-Runid": [workflowRunId],
        [WORKFLOW_INIT_HEADER]: ["false"],
        [WORKFLOW_URL_HEADER]: [workflowUrl],
        "Upstash-Workflow-CallType": ["step"],
        "Content-Type": [contentType],
      },
    };
  }

  return { headers: baseHeaders };
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
