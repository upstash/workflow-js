
import { Client } from "@upstash/qstash"
import { serve } from "@upstash/workflow/nextjs"
import { describe, test, expect } from "vitest"

// Stable throwaway destination with a valid TLS cert (replaces requestcatcher.com)
const MOCK_DESTINATION_URL = "https://example.com/"

const qstashClient = new Client({
  baseUrl: MOCK_DESTINATION_URL,
  token: "mock"
})

// mocking batch
qstashClient.batch = async () => {
  return [{ messageId: "msgId" }]
}

const { POST: serveHandler } = serve(
  async (context) => {
    await context.sleep("sleeping", 10)
  }, {
    qstashClient,
    receiver: undefined
  }
)

describe("nextjs tests", () => {
  test("should send first invocation", async () => {
    const request = new Request(MOCK_DESTINATION_URL)
    const response = await serveHandler(request)

    // it should send a request, but get failed to parse error because
    // request catcher returns string
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.workflowRunId).toBeTruthy()
  })
})
