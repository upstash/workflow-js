import { WorkflowContext } from "@upstash/workflow";
import { serve } from "@upstash/workflow/dist/nextjs";
import { fail } from "app/ci/upstash/redis";
import { nanoid } from "app/ci/utils";


export const { POST } = serve(async (context) => {
  if (context.headers.get("authorization") !== nanoid()) {
    return;
  };
}, {
  receiver: undefined,
  async failureFunction({ context }) {
    await fail(context as WorkflowContext)
  },
})