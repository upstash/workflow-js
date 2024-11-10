
import { Client } from "@upstash/qstash"
import { Redis } from "@upstash/redis"
import { serve } from "@upstash/workflow/nextjs"
import { describe, test, expect } from "bun:test"

const qstashClient = new Client({
  baseUrl: "https://workflow-tests.requestcatcher.com/",
  token: "mock"
})

// @ts-expect-error mocking publishJSON
qstashClient.publishJSON = async () => {
  return { messageId: "msgId" }
}

const { POST: serveHandler } = serve(
  async (context) => {
    await context.sleep("sleeping", 10)
  }, {
    qstashClient,
    receiver: undefined
  }
)

describe("cloudflare workers tests", () => {
  test("should send first invocation", async () => {
    const request = new Request("https://workflow-tests.requestcatcher.com/")
    const response = await serveHandler(request)

    // it should send a request, but get failed to parse error because
    // request catcher returns string
    expect(response.status).toBe(200)
    const result = await response.json() as { workflowRunId: string }
    expect(result.workflowRunId).toBeTruthy()
  })

  if (process.env.DEPLOYMENT_URL) {
    test("should run workflow successfully", async () => {
      const redis = Redis.fromEnv()
      const client = new Client({ token: process.env.QSTASH_TOKEN! })

      const secret = "secret-" + Math.floor(Math.random() * 10000).toString()
      await client.publishJSON({
        url: `${process.env.DEPLOYMENT_URL}/ci`,
        body: { text: "hello world!" },
        method: "POST",
        headers: {
          "Content-type": "text/plain",
          "secret-header": secret
        }
      })

      await new Promise(r => setTimeout(r, 4000));

      const result = await redis.get<string>(`ci-cf-ran-${secret}`)
      
      if (result !== secret) {
        throw new Error("Cloudflare workflow didn't run")
      }
    })
  } else {
    console.log("skipping workflow run tests because DEPLOYMENT_URL is not set");
  }
})
