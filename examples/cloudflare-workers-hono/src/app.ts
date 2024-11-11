import { Hono } from "hono";
import { serve, WorkflowBindings } from "@upstash/workflow/hono";
import { landingPage } from "./page";
import { Redis } from "@upstash/redis/cloudflare";

const app = new Hono<{ Bindings: WorkflowBindings }>();

app.get("/", (c) => {
  return c.html(landingPage);
});

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`;
};

app.post(
  "/workflow",
  serve<{ text: string }>(
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
  ),
);

/**
 * endpoint for the ci tests
 */
app.post(
  "/ci",
  serve<{ text: string }>(
    async (context) => {
      const input = context.requestPayload.text;
      const result1 = await context.run("step1", async () => {
        const output = someWork(input);
        console.log("step 1 input", input, "output", output);
        return output;
      });

      await context.sleep("sleep", 1);

      const secret = context.headers.get("secret-header")
      if (!secret) {
        console.error("secret not found");
        throw new Error("secret not found. can't end the CI workflow")
      } else {
        console.log("saving secret to redis");
        // @ts-expect-error env isn't typed
        const redis = Redis.fromEnv(context.env)
        await redis.set(`ci-cf-ran-${secret}`, secret, { ex: 30 })
      }
    },
    {
      receiver: undefined,
    },
  ),
);

export default app;
