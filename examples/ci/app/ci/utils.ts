import { type TestConfig } from "./types"
import { CHECK_WF_AFTER_INIT_DURATION, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER, TEST_ROUTE_PREFIX } from "./constants"
import { serve } from "@upstash/workflow/nextjs"
import * as redis from "./upstash/redis"
import * as qstash from "./upstash/qstash"

export const nanoid = () => {
  return Math.floor(Math.random() * 10000).toString()
}

/**
 * wraps the handler of the serve method to call redis.increment
 * everytime the endpoint is called.
 * 
 * Also returns a GET endpoint to return the test configuration
 * 
 * @param serveResult 
 * @param testConfig 
 * @returns 
 */
export const testServe = (
  serveResult: ReturnType<typeof serve>,
  testConfig: Omit<TestConfig, "route" | "waitForSeconds">
) => {

  const handler = async (request: Request) => {
    // get route & randomId
    const route = request.headers.get(CI_ROUTE_HEADER)
    const randomId = request.headers.get(CI_RANDOM_ID_HEADER)

    // validate route & randomId
    if (!route) {
      throw new Error(`failed to get route in test. randomId was ${randomId}`)
    }
    if (!randomId) {
      throw new Error(`failed to get randomId in test. route was ${randomId}`)
    }

    await redis.increment(route, randomId)
    return await serveResult.POST(request)
  }

  const GET = async () => {
    return new Response(JSON.stringify(testConfig), { status: 200 })
  }

  return { POST: handler, GET }
}

export const getTestConfig = async (route: string) => {
  const response = await fetch(
    `${TEST_ROUTE_PREFIX}/${route}`,
    { method: "GET" }
  )

  if (response.status !== 200) {
    throw new Error(`Failed to get the error config: ${response.statusText}`)
  }

  const testConfig = await response.json() as Parameters<typeof testServe>[1]

  return testConfig
}

export const initiateTest = async (route: string) => {
  const randomTestId = nanoid()
  const { headers, payload, expectedCallCount, expectedResult, shouldWorkflowStart = true } = await getTestConfig(route)

  const { messageId } = await qstash.startWorkflow({ route, headers, payload }, randomTestId)

  // sleep for 4 secs and check that message is delivered
  await new Promise(r => setTimeout(r, CHECK_WF_AFTER_INIT_DURATION));

  try {
    await qstash.checkWorkflowStart(messageId);
  } catch (error) {
    console.error(error);
    if (shouldWorkflowStart) {
      throw error;
    };
  }

  await redis.checkRedisForResults(route, randomTestId, expectedCallCount, expectedResult)
}

type ExpectType = number | string | object | undefined | void | boolean
export const expect = <TObject extends ExpectType = ExpectType>(
  received: TObject,
  expected: TObject
) => {
  if (received !== expected) {
    throw new Error(`Unexpected value.\n\tReceived "${received}"\n\tExpected "${expected}"`)
  }
}