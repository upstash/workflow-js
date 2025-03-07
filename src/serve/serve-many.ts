/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkflowContext } from "../context";
import { WorkflowError } from "../error";
import {
  InvokableWorkflow,
  InvokeWorkflowRequest,
  LazyInvokeStepParams,
  PublicServeOptions,
  RouteFunction,
  Step,
  Telemetry,
} from "../types";
import { getWorkflowRunId } from "../utils";
import { getHeaders } from "../workflow-requests";

export type OmitOptionsInServeMany<TOptions> = Omit<
  TOptions,
  "env" | "url" | "schema" | "initialPayloadParser"
>;

const getWorkflowId = (url: string) => {
  const components = url.split("/");
  const lastComponent = components[components.length - 1];
  return lastComponent.split("?")[0];
};

export const serveManyBase = <
  THandler extends (...params: any[]) => any,
  TOptions extends
    OmitOptionsInServeMany<PublicServeOptions> = OmitOptionsInServeMany<PublicServeOptions>,
  TServeParams extends [routeFunction: RouteFunction<any, any>, options: TOptions] = [
    routeFunction: RouteFunction<any, any>,
    options: TOptions,
  ],
>({
  workflows,
  getUrl,
  serveMethod,
  options,
}: {
  workflows: Record<string, InvokableWorkflow<any, any>>;
  getUrl: (...params: Parameters<THandler>) => string;
  serveMethod: (...params: TServeParams) => THandler;
  options?: TOptions;
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
          `Invalid workflow name found: '${workflowId}'. Workflow name cannot contain '/'.`
        );
      }

      workflowIds.push(workflowId);

      workflow[1].workflowId = workflowId;
      workflow[1].options = {
        ...options,
        ...workflow[1].options,
      };

      const params = [workflow[1].routeFunction, workflow[1].options] as TServeParams;
      const handler = serveMethod(...params);

      return [workflowId, handler];
    })
  );

  return {
    handler: async (...params: Parameters<THandler>) => {
      const url = getUrl(...params);
      const pickedWorkflowId = getWorkflowId(url);
      if (!pickedWorkflowId) {
        return new Response(
          `Unexpected request in serveMany. workflowId not set. Please update the URL of your request.`,
          {
            status: 404,
          }
        );
      }
      const workflow = workflowMap[pickedWorkflowId];
      if (!workflow) {
        return new Response(
          `No workflows in serveMany found for '${pickedWorkflowId}'. Please update the URL of your request.`,
          {
            status: 404,
          }
        );
      }
      return await workflow(...params);
    },
  };
};

export const invokeWorkflow = async <TInitialPayload, TResult>({
  settings,
  invokeStep,
  context,
  invokeCount,
  telemetry,
}: {
  settings: LazyInvokeStepParams<TInitialPayload, TResult>;
  invokeStep: Step;
  context: WorkflowContext;
  invokeCount: number;
  telemetry?: Telemetry;
}) => {
  const {
    body,
    workflow,
    headers = {},
    workflowRunId = getWorkflowRunId(),
    retries,
    flowControl,
  } = settings;
  const { workflowId } = workflow;

  const {
    retries: workflowRetries,
    failureFunction,
    failureUrl,
    useJSONContent,
    flowControl: workflowFlowControl,
  } = workflow.options;

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
    invokeCount,
    flowControl: context.flowControl,
  });
  invokerHeaders["Upstash-Workflow-Runid"] = context.workflowRunId;

  const newUrl = getNewUrlFromWorkflowId(context.url, workflowId);

  const { headers: triggerHeaders } = getHeaders({
    initHeaderValue: "true",
    workflowRunId,
    workflowUrl: newUrl,
    userHeaders: new Headers(headers) as Headers,
    retries: retries ?? workflowRetries,
    telemetry,
    failureUrl: failureFunction ? newUrl : failureUrl,
    invokeCount: invokeCount + 1,
    flowControl: flowControl ?? workflowFlowControl,
  });
  triggerHeaders["Upstash-Workflow-Invoke"] = "true";
  if (useJSONContent) {
    triggerHeaders["content-type"] = "application/json";
  }

  const request: InvokeWorkflowRequest = {
    body: JSON.stringify(body),
    headers: Object.fromEntries(
      Object.entries(invokerHeaders).map((pairs) => [pairs[0], [pairs[1]]])
    ),
    workflowRunId: context.workflowRunId,
    workflowUrl: context.url,
    step: invokeStep,
  };

  await context.qstashClient.publish({
    headers: triggerHeaders,
    method: "POST",
    body: JSON.stringify(request),
    url: newUrl,
  });
};

export const getNewUrlFromWorkflowId = (url: string, workflowId: string) => {
  return url.replace(/[^/]+$/, workflowId);
};
