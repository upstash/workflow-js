import { WORKFLOW_ID_HEADER } from "../constants";
import { WorkflowError } from "../error";
import { WorkflowLogger } from "../logger";
import {
  Claim,
  FailureFunctionPayload,
  RouteFunction,
  Telemetry,
  WorkflowClient,
  WorkflowServeOptions,
} from "../types";
import { decodeBase64, getWorkflowRunId } from "../utils";
import { WorkflowContext } from "./context";
import {
  handleThirdPartyCallResult,
  recreateUserHeaders,
  triggerFirstInvocation,
  triggerRouteFunction,
  triggerWorkflowDelete,
} from "../workflow-requests";
import { AUTH_FAIL_MESSAGE } from "../serve/options";
import { parseRequest } from "../workflow-parser";
import { DisabledWorkflowContext } from "../serve/authorization";
import { makeCancelRequest } from "../client/utils";

type FactoryPayload<TInitialPayload, TResponse extends Response> = {
  rawRequestPayload: string;
  rawHeaders: Request["headers"];

  env: WorkflowContext["env"];
  debug?: WorkflowLogger;
  initialPayloadParser: Required<
    WorkflowServeOptions<Response, TInitialPayload>
  >["initialPayloadParser"];
  failureFunction: WorkflowServeOptions<TResponse, TInitialPayload>["failureFunction"];
  onStepFinish: Required<WorkflowServeOptions<TResponse, TInitialPayload>>["onStepFinish"];
  retries: number;
  routeFunction: RouteFunction<TInitialPayload>;
  telemetry?: Telemetry;
  qstashClient: WorkflowClient;
  useJSONContent: boolean;
  workflowUrl: string;
  workflowFailureUrl?: string;
};

type FactoryResult<TResponse extends Response> = TResponse;

export class ContextFactory {
  public static async fromClaim<TInitialPayload, TResponse extends Response>(
    claim: Claim,
    params: FactoryPayload<TInitialPayload, TResponse>
  ): Promise<FactoryResult<TResponse>> {
    if (claim === "callback") {
      return this.fromCallback(params);
    } else if (claim === "failure-callback") {
      return this.fromFailureCallback(params);
    } else if (claim === "regular") {
      return this.fromWorkflowRequest(params);
    } else if (claim === "first-invocation") {
      return this.fromFirstInvocation(params);
    } else {
      throw new WorkflowError("unknown claim.");
    }
  }

  public static async fromFirstInvocation<TInitialPayload, TResponse extends Response>({
    rawRequestPayload,
    rawHeaders,
    env,
    debug,
    initialPayloadParser,
    onStepFinish,
    retries,
    routeFunction,
    telemetry,
    qstashClient,
    useJSONContent,
    workflowUrl,
    workflowFailureUrl,
  }: FactoryPayload<TInitialPayload, TResponse>): Promise<FactoryResult<TResponse>> {
    const workflowRunId = getWorkflowRunId();
    const workflowContext = new WorkflowContext<TInitialPayload>({
      env,
      debug,
      retries,
      steps: [],
      telemetry,
      qstashClient,
      workflowRunId,
      url: workflowUrl,
      failureUrl: workflowFailureUrl,
      headers: recreateUserHeaders(rawHeaders),
      initialPayload: initialPayloadParser(rawRequestPayload),
    });

    const response = await this.authorize(routeFunction, workflowContext, onStepFinish, debug);
    if (response instanceof Response) {
      return response;
    }

    const result = await triggerFirstInvocation({
      workflowContext,
      useJSONContent,
      telemetry,
      debug,
    });

    if (result.isErr()) {
      throw result.error;
    }

    return onStepFinish(workflowContext.workflowRunId, "success");
  }

  public static async fromFailureCallback<TInitialPayload, TResponse extends Response>({
    rawRequestPayload,
    env,
    debug,
    initialPayloadParser,
    failureFunction,
    onStepFinish,
    retries,
    routeFunction,
    telemetry,
    qstashClient,
  }: FactoryPayload<TInitialPayload, TResponse>): Promise<FactoryResult<TResponse>> {
    if (!failureFunction) {
      throw new WorkflowError(
        "Workflow endpoint is called to handle a failure," +
          " but a failureFunction is not provided in serve options." +
          " Either provide a failureUrl or a failureFunction."
      );
    }

    const { status, header, body, url, sourceHeader, sourceBody, workflowRunId } = JSON.parse(
      rawRequestPayload
    ) as {
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
    const errorPayload = JSON.parse(decodedBody) as FailureFunctionPayload;

    const workflowContext = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: sourceBody
        ? initialPayloadParser(decodeBase64(sourceBody))
        : (undefined as TInitialPayload),
      headers: recreateUserHeaders(new Headers(sourceHeader)),
      steps: [],
      url: url,
      failureUrl: url,
      debug,
      env,
      retries,
      telemetry,
    });

    const response = await this.authorize(routeFunction, workflowContext, onStepFinish, debug);
    if (response instanceof Response) {
      return response;
    }

    await failureFunction({
      context: workflowContext,
      failStatus: status,
      failResponse: errorPayload.message,
      failHeaders: header,
    });

    return onStepFinish(workflowContext.workflowRunId, "success");
  }

  /**
   * doesn't have the actual requestPayload. instead, has the response from
   * the called endpoint in the body
   */
  public static async fromCallback<TInitialPayload, TResponse extends Response>({
    rawRequestPayload,
    rawHeaders,
    env,
    debug,
    initialPayloadParser,
    retries,
    routeFunction,
    telemetry,
    onStepFinish,
    qstashClient,
    workflowUrl,
    workflowFailureUrl,
  }: FactoryPayload<TInitialPayload, TResponse>): Promise<FactoryResult<TResponse>> {
    const workflowRunId = getWorkflowRunId();
    const workflowContext = new WorkflowContext<TInitialPayload>({
      env,
      debug,
      retries,
      steps: [],
      telemetry,
      qstashClient,
      workflowRunId,
      url: workflowUrl,
      failureUrl: workflowFailureUrl,
      headers: recreateUserHeaders(rawHeaders),
      initialPayload: initialPayloadParser(rawRequestPayload),
    });

    const response = await this.authorize(routeFunction, workflowContext, onStepFinish, debug);
    if (response instanceof Response) {
      return response;
    }

    const result = await handleThirdPartyCallResult({
      headers: rawHeaders,
      requestPayload: rawRequestPayload,
      client: qstashClient,
      failureUrl: workflowFailureUrl,
      retries,
      telemetry,
      workflowUrl,
      debug,
    });

    if (result.isErr()) {
      // error while checking
      await debug?.log("ERROR", "SUBMIT_THIRD_PARTY_RESULT", {
        error: result.error.message,
      });
      throw result.error;
    } else if (result.value === "workflow-ended") {
      return onStepFinish(workflowContext.workflowRunId, "workflow-already-ended");
    }

    return onStepFinish(workflowContext.workflowRunId, "fromCallback");
  }

  public static async fromWorkflowRequest<TInitialPayload, TResponse extends Response>({
    rawRequestPayload,
    rawHeaders,
    env,
    debug,
    initialPayloadParser,
    retries,
    routeFunction,
    telemetry,
    qstashClient,
    workflowUrl,
    workflowFailureUrl,
    onStepFinish,
  }: FactoryPayload<TInitialPayload, TResponse> & {}): Promise<TResponse> {
    const workflowRunId = this.getWorkflowRunIdFromHeaders(rawHeaders);
    const { rawInitialPayload, steps, isLastDuplicate, workflowRunEnded } = await parseRequest(
      rawRequestPayload,
      false,
      workflowRunId,
      qstashClient.http,
      rawHeaders.get("upstash-message-id")!,
      debug
    );

    if (workflowRunEnded) {
      return onStepFinish(workflowRunId, "workflow-already-ended");
    }

    // terminate current call if it's a duplicate branch
    if (isLastDuplicate) {
      return onStepFinish(workflowRunId, "duplicate-step");
    }

    const context = new WorkflowContext<TInitialPayload>({
      qstashClient,
      workflowRunId,
      initialPayload: initialPayloadParser(rawInitialPayload),
      headers: recreateUserHeaders(rawHeaders),
      steps,
      url: workflowUrl,
      failureUrl: workflowFailureUrl,
      debug,
      env,
      retries,
      telemetry,
    });

    const result = await triggerRouteFunction({
      onStep: async () => routeFunction(context),
      onCleanup: async () => {
        await triggerWorkflowDelete(context, debug);
      },
      onCancel: async () => {
        await makeCancelRequest(context.qstashClient.http, workflowRunId);
      },
      debug,
    });

    // TODO: check auth fail

    if (result.isErr()) {
      // error while running the workflow or when cleaning up
      await debug?.log("ERROR", "ERROR", { error: result.error.message });
      throw result.error;
    }

    // @ts-expect-error accessing private field
    if (context.executor.stepCount === 0) {
      // no steps ran
      return onStepFinish(context.workflowRunId, "auth-fail");
    }

    // Returns a Response with `workflowRunId` at the end of each step.
    await debug?.log("INFO", "RESPONSE_WORKFLOW");
    return onStepFinish(context.workflowRunId, "success");
  }

  private static getWorkflowRunIdFromHeaders(headers: Request["headers"]) {
    const workflowRunId = headers.get(WORKFLOW_ID_HEADER) ?? "";
    if (workflowRunId.length === 0) {
      throw new WorkflowError("Couldn't get workflow id from header");
    }
    return workflowRunId;
  }

  private static async authorize<TInitialPayload, TResponse extends Response>(
    routeFunction: RouteFunction<TInitialPayload>,
    context: WorkflowContext<TInitialPayload>,
    onStepFinish: Required<WorkflowServeOptions<TResponse, TInitialPayload>>["onStepFinish"],
    debug?: WorkflowLogger
  ) {
    // attempt running routeFunction until the first step
    const authCheck = await DisabledWorkflowContext.tryAuthentication(routeFunction, context);
    if (authCheck.isErr()) {
      // got error while running until first step
      await debug?.log("ERROR", "ERROR", { error: authCheck.error.message });
      throw authCheck.error;
    } else if (authCheck.value === "run-ended") {
      // finished routeFunction while trying to run until first step.
      // either there is no step or auth check resulted in `return`
      await debug?.log("ERROR", "ERROR", { error: AUTH_FAIL_MESSAGE });
      return onStepFinish(context.workflowRunId, "auth-fail");
    }
  }
}
