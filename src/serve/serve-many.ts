/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKFLOW_PROTOCOL_VERSION, WORKFLOW_PROTOCOL_VERSION_HEADER } from "../constants";
import { WorkflowError } from "../error";
import { InvokableWorkflow, PublicServeOptions, RouteFunction } from "../types";

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
            headers: {
              [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            },
          }
        );
      }
      const workflow = workflowMap[pickedWorkflowId];
      if (!workflow) {
        return new Response(
          `No workflows in serveMany found for '${pickedWorkflowId}'. Please update the URL of your request.`,
          {
            status: 404,
            headers: {
              [WORKFLOW_PROTOCOL_VERSION_HEADER]: WORKFLOW_PROTOCOL_VERSION,
            },
          }
        );
      }
      return await workflow(...params);
    },
  };
};

export const getNewUrlFromWorkflowId = (url: string, workflowId?: string) => {
  if (!workflowId) {
    throw new WorkflowError("You can only call workflow which has a workflowId");
  }
  return url.replace(/[^/]+$/, workflowId);
};
