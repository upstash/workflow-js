
import { RedisEntry } from "@/utils/types"
import { Client } from "@upstash/qstash"
import { Client as WorkflowClient } from "@upstash/workflow"
import { Redis } from "@upstash/redis"
import { serve } from "@upstash/workflow/nextjs"
import { describe, test, expect } from "vitest"

export const RETRY_COUNT = 10
export const RETRY_INTERVAL_DURATION = 1000
export const CHECK_WF_AFTER_INIT_DURATION = 10000
const TEST_BUFFER_DURATION = 5000
export const TEST_TIMEOUT_DURATION = (
  CHECK_WF_AFTER_INIT_DURATION
  + (RETRY_COUNT * RETRY_INTERVAL_DURATION)
  + TEST_BUFFER_DURATION
)

type TestConfig = {
  testDescription: string,
  route: string,
  payload: undefined | string | object,
  headers: Record<string, string>,
  expectedResult: unknown,
  expectedLog?: unknown
}

const tests: TestConfig[] = [
  {
    testDescription: "should return undefined from undefined string",
    route: "api/ci",
    payload: undefined,
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: 'undefined', type: 'undefined', stringified input: 'undefined'`
  },
  {
    testDescription: "should return undefined from empty string",
    route: "api/ci",
    payload: "",
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: 'undefined', type: 'undefined', stringified input: 'undefined'`
  },
  {
    testDescription: "should return foo correctly",
    route: "api/ci",
    payload: "foo",
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: 'foo', type: 'string', stringified input: '"foo"'`
  },
  {
    testDescription: "should allow json without space",
    route: "api/ci",
    payload: `{"foo":"bar"}`,
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json object",
    route: "api/ci",
    payload: {"foo":"bar"},
    headers: {},
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json with one space",
    route: "api/ci",
    payload: `{"foo": "bar"}`,
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json with 3 spaces",
    route: "api/ci",
    payload: `{   "foo"   :   "bar"   }`,
    headers: {
      "Content-Type": "text/plain"
    },
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "shall return empty response from failure function correctly",
    route: "ci",
    payload: `fail`,
    headers: {
      "workflow-should-fail": "true"
    },
    expectedResult: `Function failed as requested`,
    expectedLog: expect.objectContaining({
      failureFunction: expect.objectContaining({
        responseBody: "{}",
        state: "DELIVERED"
      })
    })
  },
  {
    testDescription: "shall return string response from failure function correctly",
    route: "ci",
    payload: `fail`,
    headers: {
      "workflow-should-fail": "true",
      "workflow-failure-function-should-return": "true"
    },
    expectedResult: `Function failed as requested`,
    expectedLog: expect.objectContaining({
      failureFunction: expect.objectContaining({
        responseBody: JSON.stringify({ result: "response" }),
        state: "DELIVERED"
      })
    })
  }
]

const testEndpoint = ({
  testDescription,
  route,
  payload,
  headers,
  expectedResult,
  expectedLog
}: TestConfig) => {
  test(testDescription, async () => {
    if (!process.env.DEPLOYMENT_URL) {
      throw new Error("can't run test without deployment url.")
    }

    const redis = Redis.fromEnv()
    const client = new WorkflowClient({ 
      baseUrl: process.env.QSTASH_URL,
      token: process.env.QSTASH_TOKEN!
     })

    const secret = "secret-" + Math.floor(Math.random() * 10000).toString()
    
    const { workflowRunId } = await client.trigger({
      url: `${process.env.DEPLOYMENT_URL}/${route}`,
      body: payload,
      headers: {
        "secret-header": secret,
        ...headers
      },
      retries: 0
    })

    await new Promise(r => setTimeout(r, CHECK_WF_AFTER_INIT_DURATION));

    let result: RedisEntry | null = null
    for (let i=1; i<=RETRY_COUNT; i++) {
      result = await redis.get<RedisEntry>(`ci-nextjs-pages-ran-${secret}`)
      if (result) {
        break
      }
      if (i!==RETRY_COUNT) {
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_DURATION));
      }
    }
    
    expect(result).toBeDefined()
    expect(result?.secret).toBe(secret)
    expect(result?.result).toBe(expectedResult)

    if (expectedLog) {
      const logs = await client.logs({
        workflowRunId
      })
      
      expect(logs).toBeDefined()
      expect(logs.runs.length).toBe(1)
      expect(logs.runs[0]).toEqual(expectedLog)
    }
  }, TEST_TIMEOUT_DURATION)
}

describe("nextjs-pages", () => {
  test("should send first invocation", async () => {
    const qstashClient = new Client({
      baseUrl: "https://workflow-tests.requestcatcher.com/",
      token: "mock"
    })
    
    // @ts-expect-error mocking batch
    qstashClient.batch = async () => {
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

    // it should send a request, but get failed to parse error because
    // request catcher returns string
    expect(response.status).toBe(200)
    const result = await response.json() as { workflowRunId: string }
    expect(result.workflowRunId).toBeTruthy()
  })

  if (process.env.DEPLOYMENT_URL) {
    tests.forEach(test => {
      testEndpoint(test)
    })
  } else {
    console.log("skipping workflow run tests because DEPLOYMENT_URL is not set");
  }
})
