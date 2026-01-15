import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { WorkflowError } from "./error";
import {
  NO_CONCURRENCY,
  WORKFLOW_FAILURE_CALLBACK_HEADER,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_LABEL_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
  WORKFLOW_UNKOWN_SDK_VERSION_HEADER,
} from "./constants";
import type {
  FailureFunctionPayload,
  RawStep,
  Step,
  WorkflowServeOptions,
  WorkflowClient,
  RouteFunction,
} from "./types";
import { WorkflowContext } from "./context";
import { recreateUserHeaders } from "./workflow-requests";
import { decodeBase64, getWorkflowRunId } from "./utils";
import { getSteps } from "./client/utils";
import { Client } from "@upstash/qstash";
import { DisabledWorkflowContext } from "./serve/authorization";
import { DispatchDebug } from "./middleware/types";

/**
 * Gets the request body. If that fails, returns undefined
 *
 * @param request request received in the workflow api
 * @returns request body
 */
export const getPayload = async (request: Request) => {
  try {
    return await request.text();
  } catch {
    return;
  }
};

/**
 * Parses a request coming from QStash. First parses the string as JSON, which will result
 * in a list of objects with messageId & body fields. Body will be base64 encoded.
 *
 * Body of the first item will be the body of the first request received in the workflow API.
 * Rest are steps in Upstash Workflow Step format.
 *
 * When returning steps, we add the initial payload as initial step. This is to make it simpler
 * in the rest of the code.
 *
 * @param rawSteps list of raw steps from QStash
 * @returns initial payload and list of steps
 */
const processRawSteps = (rawSteps: RawStep[]) => {
  const [encodedInitialPayload, ...encodedSteps] = rawSteps;

  // decode initial payload:
  const rawInitialPayload = decodeBase64(encodedInitialPayload.body);
  const initialStep: Step = {
    stepId: 0,
    stepName: "init",
    stepType: "Initial",
    out: rawInitialPayload,
    concurrent: NO_CONCURRENCY,
  };

  // remove "toCallback" and "fromCallback" steps:
  const stepsToDecode = encodedSteps.filter((step) => step.callType === "step");

  // decode & parse other steps:
  const otherSteps = stepsToDecode.map((rawStep) => {
    const step = JSON.parse(decodeBase64(rawStep.body)) as Step;
    return step;
  });

  // join and deduplicate steps:
  const steps: Step[] = [initialStep, ...otherSteps];
  return {
    rawInitialPayload,
    steps,
  };
};

/**
 * Our steps list can potentially have duplicates. In this case, the
 * workflow SDK should get rid of the duplicates
 *
 * There are two potentials cases:
 * 1. Two results steps with equal stepId fields.
 * 2. Two plan steps with equal targetStep fields.
 *
 * @param steps steps with possible duplicates
 * @returns deduplicated steps
 */
const deduplicateSteps = (steps: Step[]): Step[] => {
  const targetStepIds: number[] = [];
  const stepIds: number[] = [];
  const deduplicatedSteps: Step[] = [];

  for (const step of steps) {
    if (step.stepId === 0) {
      // Step is a plan step
      if (!targetStepIds.includes(step.targetStep ?? 0)) {
        deduplicatedSteps.push(step);
        targetStepIds.push(step.targetStep ?? 0);
      }
    } else {
      // Step is a result step
      if (!stepIds.includes(step.stepId)) {
        deduplicatedSteps.push(step);
        stepIds.push(step.stepId);
      }
    }
  }

  return deduplicatedSteps;
};

/**
 * Checks if the last step is duplicate. If so, we will discard
 * this call.
 *
 * @param steps steps list to check
 * @param dispatchDebug optional debug dispatcher
 * @returns boolean denoting whether the last one is duplicate
 */
const checkIfLastOneIsDuplicate = async (
  steps: Step[],
  dispatchDebug?: DispatchDebug
): Promise<boolean> => {
  // return false if the length is 0 or 1
  if (steps.length < 2) {
    return false;
  }

  const lastStep = steps.at(-1)!;
  const lastStepId = lastStep.stepId;
  const lastTargetStepId = lastStep.targetStep;
  for (let index = 0; index < steps.length - 1; index++) {
    const step = steps[index];
    if (step.stepId === lastStepId && step.targetStep === lastTargetStepId) {
      const message =
        `Upstash Workflow: The step '${step.stepName}' with id '${step.stepId}'` +
        "  has run twice during workflow execution. Rest of the workflow will continue running as usual.";

      await dispatchDebug?.("onWarning", {
        warning: message,
      });
      return true;
    }
  }
  return false;
};

/**
 * Validates the incoming request checking the workflow protocol
 * version and whether it is the first invocation.
 *
 * Raises `WorkflowError` if:
 * - it's not the first invocation and expected protocol version doesn't match
 *   the request.
 * - it's not the first invocation but there is no workflow id in the headers.
 *
 * @param request request received
 * @returns whether it's the first invocation and the workflow id
 */
export const validateRequest = (
  request: Request
): { isFirstInvocation: boolean; workflowRunId: string; unknownSdk: boolean } => {
  if (request.headers.get(WORKFLOW_UNKOWN_SDK_VERSION_HEADER)) {
    const workflowRunId = request.headers.get(WORKFLOW_ID_HEADER);

    if (!workflowRunId) {
      throw new WorkflowError(
        "Couldn't get workflow id from header when handling unknown sdk request"
      );
    }

    return {
      unknownSdk: true,
      isFirstInvocation: true,
      workflowRunId,
    };
  }

  if (request.headers.get(WORKFLOW_FAILURE_CALLBACK_HEADER)) {
    // when failure callback is called, WORKFLOW_PROTOCOL_VERSION_HEADER isn't set, so
    // we consider it as first invocation. But in the case of /trigger endpoint,
    // WORKFLOW_PROTOCOL_VERSION_HEADER is set, so we check for
    // WORKFLOW_FAILURE_CALLBACK_HEADER

    const workflowRunId = request.headers.get(WORKFLOW_ID_HEADER);

    if (!workflowRunId) {
      throw new WorkflowError(
        "Couldn't get workflow id from header when handling failure callback request"
      );
    }
    return {
      unknownSdk: false,
      isFirstInvocation: true,
      workflowRunId,
    };
  }

  const versionHeader = request.headers.get(WORKFLOW_PROTOCOL_VERSION_HEADER);
  const isFirstInvocation = !versionHeader;

  // if it's not the first invocation, verify that the workflow protocal version is correct
  if (!isFirstInvocation && versionHeader !== WORKFLOW_PROTOCOL_VERSION) {
    throw new WorkflowError(
      `Incompatible workflow sdk protocol version. Expected ${WORKFLOW_PROTOCOL_VERSION},` +
        ` got ${versionHeader} from the request.`
    );
  }

  // get workflow id
  const workflowRunId = isFirstInvocation
    ? getWorkflowRunId()
    : (request.headers.get(WORKFLOW_ID_HEADER) ?? "");
  if (workflowRunId.length === 0) {
    throw new WorkflowError("Couldn't get workflow id from header");
  }

  return {
    isFirstInvocation,
    workflowRunId,
    unknownSdk: false,
  };
};

/**
 * Checks request headers and body
 * - Reads the request body as raw text
 * - Returns the steps. If it's the first invocation, steps are empty.
 *   Otherwise, steps are generated from the request body.
 *
 * @param requestPayload payload from the request
 * @param isFirstInvocation whether this is the first invocation
 * @param unknownSdk whether the request is from an unkown sdk version
 * @param workflowRunId workflow run id
 * @param requester QStash client HTTP requester
 * @param messageId optional message id
 * @param dispatchDebug optional debug dispatcher
 * @returns raw initial payload and the steps
 */
export const parseRequest = async ({
  requestPayload,
  isFirstInvocation,
  unknownSdk,
  workflowRunId,
  requester,
  messageId,
  dispatchDebug,
}: {
  requestPayload: string | undefined;
  isFirstInvocation: boolean;
  unknownSdk: boolean;
  workflowRunId: string;
  requester: Client["http"];
  messageId?: string;
  dispatchDebug?: DispatchDebug;
}): Promise<
  | {
      rawInitialPayload: string;
      steps: Step[];
      isLastDuplicate: boolean;
      workflowRunEnded: false;
    }
  | {
      rawInitialPayload: undefined;
      steps: undefined;
      isLastDuplicate: undefined;
      workflowRunEnded: true;
    }
> => {
  if (isFirstInvocation && !unknownSdk) {
    // if first invocation, return and `serve` will handle publishing the JSON to QStash
    return {
      rawInitialPayload: requestPayload ?? "",
      steps: [],
      isLastDuplicate: false,
      workflowRunEnded: false,
    };
  } else {
    let rawSteps: RawStep[];

    if (!requestPayload) {
      await dispatchDebug?.("onInfo", {
        info: "request payload is empty, steps will be fetched from QStash.",
      });

      const { steps: fetchedSteps, workflowRunEnded } = await getSteps(
        requester,
        workflowRunId,
        messageId,
        dispatchDebug
      );
      if (workflowRunEnded) {
        return {
          rawInitialPayload: undefined,
          steps: undefined,
          isLastDuplicate: undefined,
          workflowRunEnded: true,
        };
      }
      rawSteps = fetchedSteps;
    } else {
      rawSteps = JSON.parse(requestPayload) as RawStep[];
    }
    const { rawInitialPayload, steps } = processRawSteps(rawSteps);

    const isLastDuplicate = await checkIfLastOneIsDuplicate(steps, dispatchDebug);
    const deduplicatedSteps = deduplicateSteps(steps);

    return {
      rawInitialPayload,
      steps: deduplicatedSteps,
      isLastDuplicate,
      workflowRunEnded: false,
    };
  }
};

/**
 * checks if Upstash-Workflow-Is-Failure header is set to "true". If so,
 * attempts to call the failureFunction function.
 *
 * If the header is set but failureFunction is not passed, returns
 * WorkflowError.
 *
 * @param request incoming request
 * @param requestPayload payload from the request
 * @param qstashClient QStash client
 * @param initialPayloadParser parser for the initial payload
 * @param routeFunction route function to run
 * @param failureFunction function to handle the failure
 * @param env environment variables
 * @param dispatchDebug optional debug dispatcher
 */
export const handleFailure = async <TInitialPayload>({
  request,
  requestPayload,
  qstashClient,
  initialPayloadParser,
  routeFunction,
  failureFunction,
  env,
  dispatchDebug,
}: {
  request: Request;
  requestPayload: string;
  qstashClient: WorkflowClient;
  initialPayloadParser: Required<WorkflowServeOptions<TInitialPayload>>["initialPayloadParser"];
  routeFunction: RouteFunction<TInitialPayload>;
  failureFunction?: WorkflowServeOptions<TInitialPayload>["failureFunction"];
  env: WorkflowServeOptions["env"];
  dispatchDebug?: DispatchDebug;
}): Promise<
  | Ok<
      | { result: "not-failure-callback" }
      | { result: "failure-function-executed"; response: string | void }
      | { result: "failure-function-undefined" },
      never
    >
  | Err<never, Error>
> => {
  if (
    request.headers.get(WORKFLOW_FAILURE_HEADER) !== "true" &&
    !request.headers.get(WORKFLOW_FAILURE_CALLBACK_HEADER)
  ) {
    return ok({ result: "not-failure-callback" });
  }

  if (!failureFunction) {
    return ok({ result: "failure-function-undefined" });
  }

  try {
    const { status, header, body, url, sourceBody, workflowRunId } = JSON.parse(requestPayload) as {
      status: number;
      header: Record<string, string[]>;
      body: string;
      url: string;
      sourceHeader: Record<string, string[]>;
      sourceBody: string;
      workflowRunId: string;
      sourceMessageId: string;
    };

    const decodedBody = body ? decodeBase64(body) : "{}";
    let errorMessage: string = "";
    let failStack: string = "";
    try {
      const errorPayload = JSON.parse(decodedBody) as FailureFunctionPayload;
      if (errorPayload.message) {
        errorMessage = errorPayload.message;
      }
      if (errorPayload.stack) {
        failStack = errorPayload.stack;
      }
    } catch {
      // skip
    }

    if (!errorMessage) {
      errorMessage = `Couldn't parse 'failResponse' in 'failureFunction', received: '${decodedBody}'`;
    }

    const userHeaders = recreateUserHeaders(request.headers as Headers);

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: sourceBody
        ? initialPayloadParser(decodeBase64(sourceBody))
        : (undefined as TInitialPayload),
      headers: userHeaders,
      steps: [],
      url: url,
      env,
      telemetry: undefined, // not going to make requests in authentication check
      label: userHeaders.get(WORKFLOW_LABEL_HEADER) ?? undefined,
      middlewareManager: undefined,
    });

    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(
      routeFunction,
      workflowContext
    );
    if (authCheck.isErr()) {
      // got error while running until first step
      await dispatchDebug?.("onError", {
        error: authCheck.error,
      });
      return err(authCheck.error);
    } else if (authCheck.value === "run-ended") {
      // finished routeFunction while trying to run until first step.
      // either there is no step or auth check resulted in `return`
      return err(new WorkflowError("Not authorized to run the failure function."));
    }

    const failureResponse = await failureFunction({
      context: workflowContext,
      failStatus: status,
      failResponse: errorMessage,
      failHeaders: header,
      failStack,
    });
    return ok({ result: "failure-function-executed", response: failureResponse });
  } catch (error) {
    return err(error as Error);
  }
};
