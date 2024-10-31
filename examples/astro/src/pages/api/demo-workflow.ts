import { serve } from "@upstash/workflow/astro";

export const { POST } = serve(async (ctx, workflow) => {
  // Get all links were accessed before 7 days from now or not access at all
  const results = await workflow.run("step-1", async () => {
    console.log(ctx.request.url);
    return [];
  });

  if (!results.length) {
    return;
  }

  await workflow.run("step-2", async () => {
    // Do step 2
  });
});
