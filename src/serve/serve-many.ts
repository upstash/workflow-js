/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKFLOW_INVOKE_COUNT_HEADER } from "../constants";
import { WorkflowError } from "../error";
import { InvokableWorkflow, InvokeCallback, InvokeWorkflowRequest, Telemetry } from "../types";
import { getWorkflowRunId } from "../utils";
import { getHeaders } from "../workflow-requests";

export const serveManyBase = <
  TServe extends (...params: any[]) => any,
  THandlerParams extends Parameters<TServe> = Parameters<TServe>,
  TInvokableWorkflow extends InvokableWorkflow<any, any, THandlerParams> = InvokableWorkflow<
    any,
    any,
    THandlerParams
  >,
>({
  workflows,
  getWorkflowId,
}: {
  workflows: Record<string, TInvokableWorkflow>;
  getWorkflowId: (...params: THandlerParams) => string;
}) => {
  const workflowIds: (string | undefined)[] = [];

  const workflowMap: Record<string, TInvokableWorkflow["handler"]> = Object.fromEntries(
    Object.entries(workflows).map((workflow) => {
      const workflowId = workflow[0];

      if (workflowIds.includes(workflowId)) {
        throw new WorkflowError(
          `Duplicate workflow name found: '${workflowId}'. Please set different workflow names in serveMany.`
        );
      }

      if (workflowId.includes("/")) {
        throw new WorkflowError(
          `Invalid workflow name found: '${workflowId}'. Workflow name cannot contain '/'.`)
      }

      workflowIds.push(workflowId);

      workflow[1].workflowId = workflowId;

      return [workflowId, workflow[1].handler];
    })
  );

  return {
    handler: async (...params: THandlerParams) => {
      const pickedWorkflowId = getWorkflowId(...params);
      if (!pickedWorkflowId) {
        throw new WorkflowError(`Unexpected request in serveMany. workflowId not set. Please update the URL of your request.`);
      }
      const workflow = workflowMap[pickedWorkflowId];
      if (!workflow) {
        throw new WorkflowError(`No workflows in serveMany found for '${pickedWorkflowId}'. Please update the URL of your request.`);
      }
      return await workflow(...params);
    },
  };
};

export const createInvokeCallback = <TInitialPayload, TResult>(
  telemetry: Telemetry | undefined
) => {
  const invokeCallback: InvokeCallback<TInitialPayload, TResult> = async (
    settings,
    invokeStep,
    context,
    invokeCount
  ) => {
    const { body, workflow, headers = {}, workflowRunId = getWorkflowRunId(), retries } = settings;
    const { workflowId } = workflow;

    if (!workflowId) {
      throw new WorkflowError("You can only invoke workflow which has a workflowId");
    }

    const { headers: invokerHeaders } = getHeaders({
      initHeaderValue: "false",
      workflowRunId: context.workflowRunId,
      workflowUrl: context.url,
      userHeaders: context.headers,
      failureUrl: context.failureUrl,
      retries: context.retries,
      telemetry,
    });
    invokerHeaders["Upstash-Workflow-Runid"] = context.workflowRunId;

    const newUrl = context.url.replace(/[^/]+$/, workflowId);

    const { headers: triggerHeaders } = getHeaders({
      initHeaderValue: "true",
      workflowRunId,
      workflowUrl: newUrl,
      userHeaders: new Headers(headers) as Headers,
      retries: retries,
      telemetry,
    });
    triggerHeaders["Upstash-Workflow-Invoke"] = "true";
    triggerHeaders[`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = (invokeCount + 1).toString();

    const request: InvokeWorkflowRequest = {
      body: JSON.stringify(body),
      headers: Object.fromEntries(
        Object.entries(invokerHeaders).map((pairs) => [pairs[0], [pairs[1]]])
      ),
      workflowRunId,
      workflowUrl: context.url,
      step: invokeStep,
    };

    await context.qstashClient.publish({
      headers: triggerHeaders,
      method: "POST",
      body: JSON.stringify(request),
      url: newUrl,
    });

    return undefined as TResult;
  };

  return invokeCallback;
};
