/**
 * This endpoint is for the CI of workflow-js
 * 
 * You can refer to path.ts for a simpler endpoint
 */

import { RedisEntry } from "@/utils/types";
import { Redis } from "@upstash/redis";
import { WorkflowNonRetryableError } from "@upstash/workflow";
import { servePagesRouter } from "@upstash/workflow/nextjs";

const someWork = (input: unknown) => {
  return `step 1 input: '${input}', type: '${typeof input}', stringified input: '${JSON.stringify(input)}'`
}

const CI_FAIL_HEADER = "workflow-should-fail"
const CI_FAIL_MESSAGE = "Function failed as requested"
const CI_FAIL_SHOULD_RETURN_HEADER = "workflow-failure-function-should-return"

const { handler } = servePagesRouter<unknown>(
  async (context) => {
    const input = context.requestPayload
    const result1 = await context.run("step1", async () => {
      const output = someWork(input)
      return output
    });

    if (context.headers.get(CI_FAIL_HEADER) === "true") {
      throw new WorkflowNonRetryableError(CI_FAIL_MESSAGE)
    }

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
    async failureFunction({ failResponse, context }) {
      if (context.headers.get(CI_FAIL_HEADER) !== "true") {
        throw new Error("didn't receive the expected failure header")
      }

      if (failResponse !== CI_FAIL_MESSAGE) {
        throw new Error(`expected fail response to be '${CI_FAIL_MESSAGE}', got '${failResponse}'`)
      }


      const redis = new Redis({
        url: context.env["UPSTASH_REDIS_REST_URL"],
        token: context.env["UPSTASH_REDIS_REST_TOKEN"]
      })

      await redis.set<RedisEntry>(
        `ci-nextjs-pages-ran-${context.headers.get("secret-header")}`,
        {
          secret: context.headers.get("secret-header")!,
          result: failResponse
        },
        { ex: 30 }
      )

      if (context.headers.get(CI_FAIL_SHOULD_RETURN_HEADER)) {
        return "response"
      }
      return
    },
  }
)

export default handler;
