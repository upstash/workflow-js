import { serve } from "@upstash/workflow/h3";

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`;
};

const { handler } = serve<string>(async (context) => {
  const input = context.requestPayload;
  const result1 = await context.run("step1", async () => {
    const output = someWork(input);
    console.log("step 1 input", input, "output", output);
    return output;
  });

  await context.run("step2", async () => {
    const output = someWork(result1);
    console.log("step 2 input", result1, "output", output);
  });
});

export default handler
