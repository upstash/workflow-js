// this file is need for the Node 18 test

import { Client } from "@upstash/qstash"
import { serve } from "@upstash/workflow/nextjs"

const qstashClient = new Client({
  baseUrl: "https://workflow-tests.requestcatcher.com/",
  token: "mock"
})

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
const body = await response.text()

if (status !== 500) {
  throw new Error(`ci failed. incorrect status. status: ${status}, body: ${body}`)
}
if (body !== `{"error":"SyntaxError","message":"Unexpected token 'r', \\"request caught\\" is not valid JSON"}`) {
  throw new Error(`ci failed. incorrect body. status: ${status}, body: ${body}`)
}
console.log(">>> CI SUCCESFUL")