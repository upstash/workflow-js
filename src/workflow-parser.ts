import type { Err, Ok } from "neverthrow";
import { err, ok } from "neverthrow";
import { WorkflowError } from "./error";
import {
  NO_CONCURRENCY,
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_ID_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "./constants";
import type {
  FailureFunctionPayload,
  RawStep,
  Step,
  WorkflowServeOptions,
  WorkflowClient,
  WaitStepResponse,
  RouteFunction,
} from "./types";
import type { WorkflowLogger } from "./logger";
import { WorkflowContext } from "./context";
import { recreateUserHeaders } from "./workflow-requests";
import { decodeBase64, getWorkflowRunId } from "./utils";
import { getSteps } from "./client/utils";
import { Client } from "@upstash/qstash";
import { DisabledWorkflowContext } from "./serve/authorization";

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
 * @param rawSteps body of the request as a string as explained above
 * @returns intiial payload and list of steps
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

    // if event is a wait event, overwrite the out with WaitStepResponse:
    if (step.waitEventId) {
      const newOut: WaitStepResponse = {
        eventData: step.out ? decodeBase64(step.out as string) : undefined,
        timeout: step.waitTimeout ?? false,
      };
      step.out = newOut;
    }

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
 * @returns
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
 * @returns boolean denoting whether the last one is duplicate
 */
const checkIfLastOneIsDuplicate = async (
  steps: Step[],
  debug?: WorkflowLogger
): Promise<boolean> => {
  // return false if the length is 0 or 1
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  if (steps.length < 2) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const lastStep = steps.at(-1)!;
  const lastStepId = lastStep.stepId;
  const lastTargetStepId = lastStep.targetStep;
  for (let index = 0; index < steps.length - 1; index++) {
    const step = steps[index];
    if (step.stepId === lastStepId && step.targetStep === lastTargetStepId) {
      const message =
        `Upstash Workflow: The step '${step.stepName}' with id '${step.stepId}'` +
        "  has run twice during workflow execution. Rest of the workflow will continue running as usual.";
      await debug?.log("WARN", "RESPONSE_DEFAULT", message);

      console.warn(message);
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
): { isFirstInvocation: boolean; workflowRunId: string } => {
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
  };
};

/**
 * Checks request headers and body
 * - Reads the request body as raw text
 * - Returns the steps. If it's the first invocation, steps are empty.
 *   Otherwise, steps are generated from the request body.
 *
 * @param request Request received
 * @returns raw intial payload and the steps
 */
export const parseRequest = async (
  requestPayload: string | undefined,
  isFirstInvocation: boolean,
  workflowRunId: string,
  requester: Client["http"],
  messageId?: string,
  debug?: WorkflowLogger
): Promise<
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
  if (isFirstInvocation) {
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
      await debug?.log(
        "INFO",
        "ENDPOINT_START",
        "request payload is empty, steps will be fetched from QStash."
      );
      const { steps: fetchedSteps, workflowRunEnded } = await getSteps(
        requester,
        workflowRunId,
        messageId,
        debug
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

    const isLastDuplicate = await checkIfLastOneIsDuplicate(steps, debug);
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
 * @param failureFunction function to handle the failure
 */
export const handleFailure = async <TInitialPayload>(
  request: Request,
  requestPayload: string,
  qstashClient: WorkflowClient,
  initialPayloadParser: Required<
    WorkflowServeOptions<Response, TInitialPayload>
  >["initialPayloadParser"],
  routeFunction: RouteFunction<TInitialPayload>,
  failureFunction: WorkflowServeOptions<Response, TInitialPayload>["failureFunction"],
  env: WorkflowServeOptions["env"],
  retries: WorkflowServeOptions["retries"],
  flowControl: WorkflowServeOptions["flowControl"],
  debug?: WorkflowLogger
): Promise<Ok<"is-failure-callback" | "not-failure-callback", never> | Err<never, Error>> => {
  if (request.headers.get(WORKFLOW_FAILURE_HEADER) !== "true") {
    return ok("not-failure-callback");
  }

  if (!failureFunction) {
    return err(
      new WorkflowError(
        "Workflow endpoint is called to handle a failure," +
          " but a failureFunction is not provided in serve options." +
          " Either provide a failureUrl or a failureFunction."
      )
    );
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
    try {
      const errorPayload = JSON.parse(decodedBody) as FailureFunctionPayload;
      if (errorPayload.message) {
        errorMessage = errorPayload.message;
      }
    } catch {
      // skip
    }

    if (!errorMessage) {
      errorMessage = `Couldn't parse 'failResponse' in 'failureFunction', received: '${decodedBody}'`;
    }

    // create context
    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: sourceBody
        ? initialPayloadParser(decodeBase64(sourceBody))
        : (undefined as TInitialPayload),
      headers: recreateUserHeaders(request.headers as Headers),
      steps: [],
      url: url,
      failureUrl: url,
      debug,
      env,
      retries,
      flowControl,
      telemetry: undefined, // not going to make requests in authentication check
    });

    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(
      routeFunction,
      workflowContext
    );
    if (authCheck.isErr()) {
      // got error while running until first step
      await debug?.log("ERROR", "ERROR", { error: authCheck.error.message });
      throw authCheck.error;
    } else if (authCheck.value === "run-ended") {
      // finished routeFunction while trying to run until first step.
      // either there is no step or auth check resulted in `return`
      return err(new WorkflowError("Not authorized to run the failure function."));
    }

    await failureFunction({
      context: workflowContext,
      failStatus: status,
      failResponse: errorMessage,
      failHeaders: header,
    });
  } catch (error) {
    return err(error as Error);
  }

  return ok("is-failure-callback");
};
