// this file is need for the Node 18 test

import { Client } from "@upstash/qstash"
import { serve } from "@upstash/workflow/nextjs"

const qstashClient = new Client({
  baseUrl: `https://workflow-tests.requestcatcher.com/`,
  token: "mock",
})

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
console.log(">>> CI SUCCESFUL")