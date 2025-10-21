
import { Redis } from "@upstash/redis"
import { Client as WorkflowClient } from "@upstash/workflow"
import { describe, test, expect } from "vitest"
import { RedisEntry } from "./api"
import "dotenv/config"

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
  expectedResult: unknown
}

const tests: TestConfig[] = [
  {
    testDescription: "should return undefined from undefined string",
    route: "ci",
    payload: undefined,
    headers: {},
    expectedResult: `step 1 input: 'undefined', type: 'undefined', stringified input: 'undefined'`
  },
  {
    testDescription: "should return undefined from empty string",
    route: "ci",
    payload: "",
    headers: {},
    expectedResult: `step 1 input: 'undefined', type: 'undefined', stringified input: 'undefined'`
  },
  {
    testDescription: "should return foo correctly",
    route: "ci",
    payload: "foo",
    headers: {},
    expectedResult: `step 1 input: 'foo', type: 'string', stringified input: '"foo"'`
  },
  {
    testDescription: "should allow json without space",
    route: "ci",
    payload: `{"foo":"bar"}`,
    headers: {},
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json object",
    route: "ci",
    payload: {"foo":"bar"},
    headers: {},
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json with one space",
    route: "ci",
    payload: `{"foo": "bar"}`,
    headers: {},
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  },
  {
    testDescription: "should allow json with 3 spaces",
    route: "ci",
    payload: `{   "foo"   :   "bar"   }`,
    headers: {},
    expectedResult: `step 1 input: '[object Object]', type: 'object', stringified input: '{"foo":"bar"}'`
  }
]

const testEndpoint = ({
  testDescription,
  route,
  payload,
  headers,
  expectedResult,
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

    await client.trigger({
      url: `${process.env.DEPLOYMENT_URL}/${route}`,
      body: payload,
      headers: {
        "secret-header": secret,
        ...headers,
        "content-type": "application/json"
      },
      retries: 0
    })

    await new Promise(r => setTimeout(r, CHECK_WF_AFTER_INIT_DURATION));

    let result: RedisEntry | null = null
    for (let i=1; i<=RETRY_COUNT; i++) {
      result = await redis.get<RedisEntry>(`ci-cf-ran-${secret}`)
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
  }, TEST_TIMEOUT_DURATION)
}

describe("express", () => {

  if (process.env.DEPLOYMENT_URL) {
    tests.forEach(test => {
      testEndpoint(test)
    })
  } else {
    console.log("skipping workflow run tests because DEPLOYMENT_URL is not set");
  }
})
