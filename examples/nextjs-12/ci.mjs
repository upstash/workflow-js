// this file is need for the Node 18 test

import { Client } from "@upstash/qstash"
import { Redis } from "@upstash/redis"
import { serve } from "@upstash/workflow/nextjs"

export const RETRY_COUNT = 5
export const RETRY_INTERVAL_DURATION = 5000
export const CHECK_WF_AFTER_INIT_DURATION = 10000

const qstashClient = new Client({
  baseUrl: `https://workflow-tests.requestcatcher.com/`,
  token: "mock",
})

qstashClient.publish = async () => {
  return { messageId: "msgId" }
}

console.log(">>> TESTING INITIAL INVOCATION")

const { POST: serveHandler } = serve(
  async (context) => {
    await context.sleep("sleeping", 10)
  }, {
    qstashClient,
    receiver: undefined
  }
)

const request = new Request("https://workflow-tests.requestcatcher.com/")
const response = await serveHandler(request)

const status = response.status
const body = await response.json()

if (status !== 200) {
  throw new Error(`ci failed. incorrect status. status: ${status}, body: ${body}`)
}
if (!body.workflowRunId) {
  throw new Error(`ci failed. body doesn't have workflowRunId field. status: ${status}, body: ${body}`)
}

console.log(">>> TESTED INITIAL INVOCATION SUCCESFULLY")

const deploymentUrl = process.env.DEPLOYMENT_URL
if (deploymentUrl) {
  console.log(">>> TESTING WORKFLOW RUN")

  const client = new Client({
    token: process.env.QSTASH_TOKEN,
  })
  const redis = Redis.fromEnv()

  const secret = "secret-" + Math.floor(Math.random() * 10000).toString()
  await client.publishJSON({
    url: `${deploymentUrl}/api/ci`,
    method: "POST",
    body: "hello world!",
    headers: {
      "Content-type": "text/plain",
      "secret-header": secret
    }
  })

  await new Promise(r => setTimeout(r, CHECK_WF_AFTER_INIT_DURATION));

  let result

    for (let i=1; i<=RETRY_COUNT; i++) {
      result = await redis.get(`ci-cf-ran-${secret}`)
      if (result) {
        break
      }
      if (i!==RETRY_COUNT) {
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_DURATION));
      }
    }
  
  if (result !== secret) {
    throw new Error("Cloudflare workflow didn't run")
  }

  console.log(">>> TESTED WORKFLOW RUN SUCCESFULLY")
} else {
  console.warn(">>> SKIPPING WORKFLOW RUN TEST. DEPLOYMENT_URL NOT SET")
}
