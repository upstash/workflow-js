import { serve } from "@upstash/workflow/react-router";

export const action = serve<{ message: string }>(
  async (context) => {
    const input = context.requestPayload;

    await context.run("initial processing", async () => {
      console.log("Workflow started:", context.workflowRunId);
      console.log("Sleeping 2 seconds");
      
    });

    await context.sleep("sleep for 2 seconds", 2);

    await context.run("make an api call", async () => {
      console.log("slept 2 seconds");
      console.log("api call result:", input.message);
    });

    await context.run("completing", async () => {
      console.log("Workflow completed:", context.workflowRunId);      
    })
  }
);
