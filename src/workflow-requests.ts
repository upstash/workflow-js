import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import {
  isInstanceOf,
  WorkflowAbort,
  WorkflowError,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from "./error";
import type { WorkflowContext } from "./context";
import {
  TELEMETRY_HEADER_FRAMEWORK,
  TELEMETRY_HEADER_RUNTIME,
  TELEMETRY_HEADER_SDK,
  WORKFLOW_LABEL_HEADER,
} from "./constants";
import type { Telemetry, WorkflowReceiver } from "./types";
import { PublishBatchRequest, PublishRequest, QstashError } from "@upstash/qstash";
import { getHeaders } from "./qstash/headers";
import { PublishToUrlResponse } from "@upstash/qstash";
import { DispatchDebug } from "./middleware/types";
import { MiddlewareManager } from "./middleware/manager";

type TriggerFirstInvocationParams<TInitialPayload> = {
  workflowContext: WorkflowContext<TInitialPayload>;
  useJSONContent?: boolean;
  telemetry?: Telemetry;
  invokeCount?: number;
  delay?: PublishRequest["delay"];
  notBefore?: PublishRequest["notBefore"];
  middlewareManager?: MiddlewareManager;
};

export const triggerFirstInvocation = async <TInitialPayload>(
  params:
    | TriggerFirstInvocationParams<TInitialPayload>
    | TriggerFirstInvocationParams<TInitialPayload>[]
): Promise<Ok<"success" | "workflow-run-already-exists", never> | Err<never, Error>> => {
  const firstInvocationParams = Array.isArray(params) ? params : [params];
  const workflowContextClient = firstInvocationParams[0].workflowContext.qstashClient;

  const invocationBatch = firstInvocationParams.map(
    ({ workflowContext, useJSONContent, telemetry, invokeCount, delay, notBefore }) => {
      const { headers } = getHeaders({
        initHeaderValue: "true",
        workflowConfig: {
          workflowRunId: workflowContext.workflowRunId,
          workflowUrl: workflowContext.url,
          failureUrl: workflowContext.failureUrl,
          retries: workflowContext.retries,
          retryDelay: workflowContext.retryDelay,
          telemetry: telemetry,
          flowControl: workflowContext.flowControl,
          useJSONContent: useJSONContent ?? false,
        },
        invokeCount: invokeCount ?? 0,
        userHeaders: workflowContext.headers,
        keepTriggerConfig: true,
      });

      // QStash doesn't forward content-type when passed in `upstash-forward-content-type`
      // so we need to pass it in the headers
      if (workflowContext.headers.get("content-type")) {
        headers["content-type"] = workflowContext.headers.get("content-type")!;
      }

      if (useJSONContent) {
        headers["content-type"] = "application/json";
      }

      /**
       * WORKFLOW_LABEL_HEADER exists in the headers with forward prefix
       * so that it can be passed to the workflow context in subsequent steps.
       *
       * we also need to set it here without the prefix so that server
       * sets the label of the workflow run.
       */
      if (workflowContext.label) {
        headers[WORKFLOW_LABEL_HEADER] = workflowContext.label;
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
        notBefore: notBefore,
      } as PublishBatchRequest;
    }
  );

  try {
    const results = (await workflowContextClient.batch(invocationBatch)) as PublishToUrlResponse[];

    const invocationStatuses: ("success" | "workflow-run-already-exists")[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const invocationParams = firstInvocationParams[i];

      invocationParams.middlewareManager?.assignContext(invocationParams.workflowContext);

      if (result.deduplicated) {
        await invocationParams.middlewareManager?.dispatchDebug("onWarning", {
          warning: `Workflow run ${invocationParams.workflowContext.workflowRunId} already exists. A new one isn't created.`,
        });
        invocationStatuses.push("workflow-run-already-exists");
      } else {
        await invocationParams.middlewareManager?.dispatchDebug("onInfo", {
          info: `Workflow run ${invocationParams.workflowContext.workflowRunId} has been started successfully with URL ${invocationParams.workflowContext.url}.`,
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

export const triggerRouteFunction = async <TResult = unknown>({
  onCleanup,
  onStep,
  onCancel,
  middlewareManager,
}: {
  onStep: () => Promise<TResult>;
  onCleanup: (result: TResult) => Promise<void>;
  onCancel: () => Promise<void>;
  middlewareManager?: MiddlewareManager;
}): Promise<
  | Ok<
      | "workflow-finished"
      | "step-finished"
      | "workflow-was-finished"
      | WorkflowNonRetryableError
      | WorkflowRetryAfterError,
      never
    >
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
    if (isInstanceOf(error, QstashError) && error.status === 400) {
      await middlewareManager?.dispatchDebug("onWarning", {
        warning: `Tried to append to a cancelled workflow. Exiting without publishing. Error: ${error.message}`,
      });
      return ok("workflow-was-finished");
    } else if (
      isInstanceOf(error_, WorkflowNonRetryableError) ||
      isInstanceOf(error_, WorkflowRetryAfterError)
    ) {
      return ok(error_);
    } else if (!isInstanceOf(error_, WorkflowAbort)) {
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
  result: unknown,
  cancel = false,
  dispatchDebug?: DispatchDebug
): Promise<void> => {
  await dispatchDebug?.("onInfo", {
    info:
      `Deleting workflow run ${workflowContext.workflowRunId} from QStash` +
      (cancel ? " with cancel=true." : "."),
  });
  await workflowContext.qstashClient.http.request({
    path: ["v2", "workflows", "runs", `${workflowContext.workflowRunId}?cancel=${cancel}`],
    method: "DELETE",
    parseResponseAsJson: false,
    body: JSON.stringify(result),
  });
  await dispatchDebug?.("onInfo", {
    info: `Workflow run ${workflowContext.workflowRunId} deleted from QStash successfully.`,
  });
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

    const isUserHeader =
      (!headerLowerCase.startsWith("upstash-workflow-") &&
        // https://vercel.com/docs/edge-network/headers/request-headers#x-vercel-id
        !headerLowerCase.startsWith("x-vercel-") &&
        !headerLowerCase.startsWith("x-forwarded-") &&
        // https://blog.cloudflare.com/preventing-request-loops-using-cdn-loop/
        headerLowerCase !== "cf-connecting-ip" &&
        headerLowerCase !== "cdn-loop" &&
        headerLowerCase !== "cf-ew-via" &&
        headerLowerCase !== "cf-ray" &&
        // For Render https://render.com
        headerLowerCase !== "render-proxy-ttl") ||
      headerLowerCase === WORKFLOW_LABEL_HEADER.toLocaleLowerCase();

    if (isUserHeader) {
      filteredHeaders.append(header, value);
    }
  }

  return filteredHeaders as Headers;
};

export type HeadersResponse = {
  headers: Record<string, string>;
  contentType: string;
};

export const getTelemetryHeaders = (telemetry: Telemetry) => {
  return {
    [TELEMETRY_HEADER_SDK]: telemetry.sdk,
    [TELEMETRY_HEADER_FRAMEWORK]: telemetry.framework ?? "unknown",
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
