/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKFLOW_INVOKE_COUNT_HEADER } from "../constants";
import { WorkflowError } from "../error";
import { InvokableWorkflow, InvokeCallback, InvokeWorkflowRequest, PublicServeOptions, RouteFunction, Telemetry } from "../types";
import { getWorkflowRunId } from "../utils";
import { getHeaders } from "../workflow-requests";

export type OmitOptionsInServeMany<TOptions> = Omit<TOptions, "env" | "url" | "schema" | "initialPayloadParser">

export const serveManyBase = <
  THandler extends (...params: any[]) => any,
  TOptions extends OmitOptionsInServeMany<PublicServeOptions> = OmitOptionsInServeMany<PublicServeOptions>,
  TServeParams extends [routeFunction: RouteFunction<any, any>, options: TOptions] = [routeFunction: RouteFunction<any, any>, options: TOptions]
>({
  workflows,
  getWorkflowId,
  serveMethod,
  options
}: {
  workflows: Record<string, InvokableWorkflow<any, any>>;
  getWorkflowId: (...params: Parameters<THandler>) => string;
  serveMethod: (...params: TServeParams) => THandler,
  options?: TOptions
}) => {
  const workflowIds: (string | undefined)[] = [];

  const workflowMap: Record<string, THandler> = Object.fromEntries(
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
      workflow[1].options = {
        ...options,
        ...workflow[1].options,
      };

      const params = [workflow[1].routeFunction, workflow[1].options] as TServeParams;
      const handler = serveMethod(...params)

      return [workflowId, handler];
    })
  );

  return {
    handler: async (...params: Parameters<THandler>) => {
      const pickedWorkflowId = getWorkflowId(...params);
      if (!pickedWorkflowId) {
        return new Response(`Unexpected request in serveMany. workflowId not set. Please update the URL of your request.`, {
          status: 404
        });
      }
      const workflow = workflowMap[pickedWorkflowId];
      if (!workflow) {
        return new Response(`No workflows in serveMany found for '${pickedWorkflowId}'. Please update the URL of your request.`, {
          status: 404
        });
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

    const { retries: workflowRetries, failureFunction, failureUrl, useJSONContent } = workflow.options;

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
      retries: retries ?? workflowRetries,
      telemetry,
      failureUrl: failureFunction ? newUrl : failureUrl,
    });
    triggerHeaders["Upstash-Workflow-Invoke"] = "true";
    triggerHeaders[`Upstash-Forward-${WORKFLOW_INVOKE_COUNT_HEADER}`] = (invokeCount + 1).toString();
    if (useJSONContent) {
      triggerHeaders["content-type"] = "application/json";
    }

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
