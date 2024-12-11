import { serve } from "@upstash/workflow/express";
import express from 'express';
import { config } from 'dotenv';
import { Redis } from "@upstash/redis"

// Load environment variables
config();

const app = express();

app.use(express.json());

const someWork = (input: string) => {
  return `processed: '${JSON.stringify(input)}'`
}

app.use('/workflow', serve<{ message: string }>(async (context) => {
  const input = context.requestPayload

  const result1 = await context.run('step1', async () => {
    const output = someWork(input.message)
    console.log('step 1 input', input, 'output', output)
    return output
  })

  const { body } = await context.call("get-data", {
    url: `${process.env.UPSTASH_WORKFLOW_URL ?? "http://localhost:3001"}/get-data`,
    method: "POST",
    body: { message: result1 }
  })

  await context.run('step2', async () => {
    const message = (body as string)
    const output = someWork(message)
    console.log('step 2 input', result1, 'output', output)
    return output
  })
}));

/**
 * CI ROUTE
 */

export type RedisEntry = {
  secret: string,
  result: unknown
}

app.post("/ci", serve(
  async (context) => {
    const input = context.requestPayload
    const result1 = await context.run("step1", async () => {
      const output = `step 1 input: '${input}', type: '${typeof input}', stringified input: '${JSON.stringify(input)}'`
      return output
    });

    await context.sleep("sleep", 1);
    
    const secret = context.headers.get("secret-header")
    if (!secret) {
      console.error("secret not found");
      throw new Error("secret not found. can't end the CI workflow")
    } else {
      const redis = new Redis({
        url: context.env["UPSTASH_REDIS_REST_URL"],
        token: context.env["UPSTASH_REDIS_REST_TOKEN"]
      })
      await redis.set<RedisEntry>(
        `ci-cf-ran-${secret}`,
        {
          secret,
          result: result1
        },
        { ex: 30 }
      )
    }
  }
))

app.listen(3000, () => {
  console.log('Server running on port 3000');
});