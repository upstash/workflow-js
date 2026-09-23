import { MiddlewareCallbacks } from "./types";

export const onErrorWithConsole: Required<
  MiddlewareCallbacks<unknown, unknown>
>["onError"] = async ({ workflowRunId, error }) => {
  console.error(`  [Upstash Workflow]: Error in workflow run ${workflowRunId}: ` + error);
};

export const onWarningWithConsole: Required<
  MiddlewareCallbacks<unknown, unknown>
>["onWarning"] = async ({ workflowRunId, warning }) => {
  console.warn(`  [Upstash Workflow]: Warning in workflow run ${workflowRunId}: ` + warning);
};

export const onInfoWithConsole: Required<MiddlewareCallbacks<unknown, unknown>>["onInfo"] = async ({
  workflowRunId,
  info,
}) => {
  console.info(`  [Upstash Workflow]: Info in workflow run ${workflowRunId}: ` + info);
};
