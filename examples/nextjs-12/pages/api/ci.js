/**
 * this endpoint is for the CI of @upstash/workflow.
 * 
 * refer to workflow.js for a simpler example.
 */
import { servePagesRouter } from "@upstash/workflow/nextjs";
import { Redis } from "@upstash/redis"

const someWork = (input) => {
  return `processed '${JSON.stringify(input)}'`
}

const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.UPSTASH_WORKFLOW_URL
    ? process.env.UPSTASH_WORKFLOW_URL
    : "http://localhost:3001"

const endpointUrl = `${baseUrl}/api/ci`

const redis = Redis.fromEnv()

const { handler } = servePagesRouter(
  async (context) => {
    const input = context.requestPayload
    const result1 = await context.run("step1", async () => {
      const output = someWork(input)
      console.log("step 1 input", input, "output", output)
      return output
    });

    await context.sleep("sleep", 1);

    const secret = context.headers.get("secret-header")
    if (!secret) {
      console.error("secret not found");
      throw new Error("secret not found. can't end the CI workflow")
    } else {
      console.log("saving secret to redis");
      await redis.set(`ci-cf-ran-${secret}`, secret, { ex: 30 })
    }
  },
  {
    retries: 0,
    url: endpointUrl
  }
)

export default handler
