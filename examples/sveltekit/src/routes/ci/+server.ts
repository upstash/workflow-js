import { serve } from "@upstash/workflow/svelte";
import { env } from '$env/dynamic/private'
import type { RedisEntry } from "../../types";
import { Redis } from "@upstash/redis"

export const { POST } = serve(
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
  },
  {
    env,
    retries: 0,
  }
)
