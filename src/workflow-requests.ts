import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { QStashWorkflowAbort, QStashWorkflowError } from "./error";
import type { WorkflowContext } from "./context";
import {
  DEFAULT_CONTENT_TYPE,
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
  Step,
  StepType,
  WorkflowClient,
  WorkflowReceiver,
  WorkflowServeOptions,
} from "./types";
import { StepTypes } from "./types";
import type { WorkflowLogger } from "./logger";
import { QstashError } from "@upstash/qstash";

export const triggerFirstInvocation = async <TInitialPayload>(
  workflowContext: WorkflowContext<TInitialPayload>,
  retries: number,
  debug?: WorkflowLogger
): Promise<Ok<"success" | "workflow-run-already-exists", never> | Err<never, Error>> => {
  const { headers } = getHeaders(
    "true",
    workflowContext.workflowRunId,
    workflowContext.url,
    workflowContext.headers,
    undefined,
    workflowContext.failureUrl,
    retries
  );
  try {
    const result = await workflowContext.qstashClient.publishJSON({
      headers,
      method: "POST",
      body: workflowContext.requestPayload,
      url: workflowContext.url,
    });

    await debug?.log("SUBMIT", "SUBMIT_FIRST_INVOCATION", {
      headers,
      requestPayload: workflowContext.requestPayload,
      url: workflowContext.url,
      messageId: result.messageId,
    });
    return ok("success");
  } catch (error) {
    const error_ = error as Error;
    if (
      error instanceof QstashError &&
      error.message.includes("a workflow already exists, can not initialize a new one with same id")
    ) {
      await debug?.log("WARN", "SUBMIT_FIRST_INVOCATION", {
        message: `Workflow run ${workflowContext.workflowRunId} already exists.`,
        name: error.name,
        originalMessage: error.message,
      });
      return ok("workflow-run-already-exists");
    }
    return err(error_);
  }
};

export const triggerRouteFunction = async ({
  onCleanup,
  onStep,
  debug,
}: {
  onStep: () => Promise<void>;
  onCleanup: () => Promise<void>;
  debug?: WorkflowLogger;
}): Promise<
  Ok<"workflow-finished" | "step-finished" | "workflow-was-finished", never> | Err<never, Error>
> => {
  try {
    // When onStep completes successfully, it throws an exception named `QStashWorkflowAbort`, indicating that the step has been successfully executed.
    // This ensures that onCleanup is only called when no exception is thrown.
    await onStep();
    await onCleanup();
    return ok("workflow-finished");
  } catch (error) {
    const error_ = error as Error;
    if (
      error instanceof QstashError &&
      error.message.includes("can not append to a a cancelled workflow")
    ) {
      await debug?.log("WARN", "RESPONSE_WORKFLOW", {
        message: `tried to append to a cancelled workflow. exiting without publishing.`,
        name: error.name,
        originalMessage: error.message,
      });
      return ok("workflow-was-finished");
    }
    return error_ instanceof QStashWorkflowAbort ? ok("step-finished") : err(error_);
  }
};

export const triggerWorkflowDelete = async <TInitialPayload>(
  workflowContext: WorkflowContext<TInitialPayload>,
  debug?: WorkflowLogger,
  cancel = false
): Promise<{ deleted: boolean }> => {
  await debug?.log("SUBMIT", "SUBMIT_CLEANUP", {
    deletedWorkflowRunId: workflowContext.workflowRunId,
  });

  try {
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
    return { deleted: true };
  } catch (error) {
    if (
      error instanceof QstashError &&
      error.message.includes(`workflowRun ${workflowContext.workflowRunId} not found`)
    ) {
      await debug?.log("WARN", "SUBMIT_CLEANUP", {
        message: `Failed to remove workflow run ${workflowContext.workflowRunId} as it doesn't exist.`,
        name: error.name,
        originalMessage: error.message,
      });
      return { deleted: false };
    }
    throw error;
  }
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
      !headerLowerCase.startsWith("x-vercel-") &&
      !headerLowerCase.startsWith("x-forwarded-") &&
      headerLowerCase !== "cf-connecting-ip"
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
export const handleThirdPartyCallResult = async (
  request: Request,
  requestPayload: string,
  client: WorkflowClient,
  workflowUrl: string,
  failureUrl: WorkflowServeOptions["failureUrl"],
  retries: number,
  debug?: WorkflowLogger
): Promise<
  Ok<"is-call-return" | "continue-workflow" | "call-will-retry", never> | Err<never, Error>
> => {
  try {
    if (request.headers.get("Upstash-Workflow-Callback")) {
      const callbackMessage = JSON.parse(requestPayload) as {
        status: number;
        body: string;
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
          body: atob(callbackMessage.body),
        });
        // this callback will be retried by the QStash, we just ignore it
        console.warn(
          `Workflow Warning: "context.call" failed with status ${callbackMessage.status}` +
            ` and will retry (retried ${callbackMessage.retried ?? 0} out of ${callbackMessage.maxRetries} times).` +
            ` Error Message:\n${atob(callbackMessage.body)}`
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
      const { headers: requestHeaders } = getHeaders(
        "false",
        workflowRunId,
        workflowUrl,
        userHeaders,
        undefined,
        failureUrl,
        retries
      );

      const callResponse: CallResponse = {
        status: callbackMessage.status,
        body: atob(callbackMessage.body),
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
      new QStashWorkflowError(
        `Error when handling call return (isCallReturn=${isCallReturn}): ${error}`
      )
    );
  }
};

export type HeadersResponse = {
  headers: Record<string, string>;
  timeoutHeaders?: Record<string, string[]>;
};

/**
 * Gets headers for calling QStash
 *
 * @param initHeaderValue Whether the invocation should create a new workflow
 * @param workflowRunId id of the workflow
 * @param workflowUrl url of the workflow endpoint
 * @param step step to get headers for. If the step is a third party call step, more
 *       headers are added.
 * @returns headers to submit
 */
export const getHeaders = (
  initHeaderValue: "true" | "false",
  workflowRunId: string,
  workflowUrl: string,
  userHeaders?: Headers,
  step?: Step,
  failureUrl?: WorkflowServeOptions["failureUrl"],
  retries?: number
): HeadersResponse => {
  const baseHeaders: Record<string, string> = {
    [WORKFLOW_INIT_HEADER]: initHeaderValue,
    [WORKFLOW_ID_HEADER]: workflowRunId,
    [WORKFLOW_URL_HEADER]: workflowUrl,
  };

  if (!step?.callUrl) {
    baseHeaders[`Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}`] = WORKFLOW_PROTOCOL_VERSION;
  }

  if (failureUrl) {
    if (!step?.callUrl) {
      baseHeaders[`Upstash-Failure-Callback-Forward-${WORKFLOW_FAILURE_HEADER}`] = "true";
    }
    baseHeaders["Upstash-Failure-Callback"] = failureUrl;
  }

  // if retries is set or if call url is passed, set a retry
  // for call url, retry is 0
  if (step?.callUrl) {
    baseHeaders["Upstash-Retries"] = "0";
    baseHeaders[WORKFLOW_FEATURE_HEADER] = "WF_NoDelete";

    // if some retries is set, use it in callback and failure callback
    if (retries) {
      baseHeaders["Upstash-Callback-Retries"] = retries.toString();
      baseHeaders["Upstash-Failure-Callback-Retries"] = retries.toString();
    }
  } else if (retries !== undefined) {
    baseHeaders["Upstash-Retries"] = retries.toString();
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
    throw new QStashWorkflowError(
      `Failed to verify that the Workflow request comes from QStash: ${error}\n\n` +
        "If signature is missing, trigger the workflow endpoint by publishing your request to QStash instead of calling it directly.\n\n" +
        "If you want to disable QStash Verification, you should clear env variables QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY"
    );
  }
};
