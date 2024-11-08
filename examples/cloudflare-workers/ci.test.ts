
import { Client } from "@upstash/qstash"
import { serve } from "@upstash/workflow/nextjs"
import { describe, test, expect } from "bun:test"

const qstashClient = new Client({
  baseUrl: "https://workflow-tests.requestcatcher.com/",
  token: "mock"
})

const { POST: serveHandler } = serve(
  async (context) => {
    await context.sleep("sleeping", 10)
  }, {
    // @ts-expect-error type mismatch
    qstashClient,
    receiver: undefined
  }
)

describe("nextjs tests", () => {
  test("first invocation", async () => {
    const request = new Request("https://workflow-tests.requestcatcher.com/")
    const response = await serveHandler(request)

    // it should send a request, but get failed to parse error because
    // request catcher returns string
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "SyntaxError",
      message: "Failed to parse JSON",
    })
  })
})
