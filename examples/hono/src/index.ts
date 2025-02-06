import { Hono } from "hono";
// import { serve } from "@upstash/workflow/hono";
import { createWorkflow, serve, serveMany } from "@upstash/workflow/hono";
import { landingPage } from "./page";
import { WorkflowContext } from "@upstash/workflow";

const app = new Hono();

app.get("/", (c) => {
  return c.html(landingPage);
});

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`;
};

const handler = serve<{ text: string }>(
  async (context) => {
    const input = context.requestPayload.text;
    const result1 = await context.run("step1", async () => {
      const output = someWork(input);
      console.log("step 1 input", input, "output", output);
      return output;
    });

    await context.run("step2", async () => {
      const output = someWork(result1);
      console.log("step 2 input", result1, "output", output);
    });
  },
  {
    receiver: undefined,
  },
)

app.post(
  "/workflow",
  handler
);

// serveMany example

const workflowOne = createWorkflow(async (context) => {
  await context.run("step 1", async () => {
    console.log("workflow one says hi")
  })

  const { body, isCanceled, isFailed } = await context.invoke("invoking other", {
    workflow: workflowTwo,
    body: "hello from workflow one",
  })

  await context.run("checking invoke results", () => {
    console.log("invoke results", { body, isCanceled, isFailed })
  })

  await context.run("step 2", async () => {
    console.log("workflow one says bye")
  })
})

const workflowTwo = createWorkflow(async (context: WorkflowContext<string>) => {
  await context.run("step 1", async () => {
    console.log("workflow two says hi")
  })

  await context.run("step 2", async () => {
    console.log("workflow two says bye")
  })

  return "workflow two done"
}, {
  retries: 0
})

app.post("/serve-many/*", serveMany({
  workflowOne,
  workflowTwo
}));
export default app;
