import { WorkflowContext } from "@upstash/workflow";
import { serve } from "@upstash/workflow/nextjs";
import { fail } from "app/ci/upstash/redis";
import { nanoid } from "app/ci/utils";


export const { POST } = serve(async (context) => {
  // no expectWorkflowRunCreatedAt here: this endpoint only receives the forged requests
  // of auth/custom/workflow to check that they are rejected, one of them being a fake
  // failure callback without the creation time of a run.
  if (context.headers.get("authorization") !== nanoid()) {
    return;
  };
}, {
  receiver: undefined,
  async failureFunction({ context, failResponse }) {
    console.error("failing:", failResponse);
    await fail(context as WorkflowContext)
  },
})