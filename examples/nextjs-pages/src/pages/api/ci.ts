/**
 * This endpoint is for the CI of workflow-js
 * 
 * You can refer to path.ts for a simpler endpoint
 */

import { RedisEntry } from "@/utils/types";
import { Redis } from "@upstash/redis";
import { servePagesRouter } from "@upstash/workflow/nextjs";

const someWork = (input: unknown) => {
  return `step 1 input: '${input}', type: '${typeof input}', stringified input: '${JSON.stringify(input)}'`
}

const { handler } = servePagesRouter<unknown>(
  async (context) => {
    const input = context.requestPayload
    const result1 = await context.run("step1", async () => {
      const output = someWork(input)
      return output
    });

    await context.sleep("sleep", 1);
    
    const secret = context.headers.get("secret-header")
    if (!secret) {
      console.error("secret not found");
      throw new Error("secret not found. can't end the CI workflow")
    } else {
      const redis = Redis.fromEnv()
      await redis.set<RedisEntry>(
        `ci-nextjs-pages-ran-${secret}`,
        {
          secret,
          result: result1
        },
        { ex: 30 }
      )
    }
  },
  {
    retries: 0,
  }
)

export default handler;
