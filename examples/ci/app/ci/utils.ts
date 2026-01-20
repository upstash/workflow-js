import { RouteConfigs, TriggerConfig, type TestConfig } from "./types"
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
  testConfig: Omit<TestConfig, RouteConfigs>
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

export const initiateTest = async (params: Pick<TestConfig, "route">) => {
  const randomTestId = nanoid()
  const { route } = params
  const { headers, payload, expectedCallCount, expectedResult, triggerConfig, shouldWorkflowStart = true } = await getTestConfig(route)

  const { workflowRunId } = await qstash.startWorkflow({ route, headers, payload, triggerConfig }, randomTestId)

  // sleep for 4 secs and check that message is delivered
  await new Promise(r => setTimeout(r, CHECK_WF_AFTER_INIT_DURATION));

  try {
    await eventually(async () => {
      await qstash.checkWorkflowStart(workflowRunId);
    })
  } catch (error) {
    console.error(error);
    if (shouldWorkflowStart) {
      throw error;
    };
  }

  try {
    await redis.checkRedisForResults(route, randomTestId, expectedCallCount, expectedResult)
  } catch (error) {
    try {
      const logs = await qstash.getWorkflowLogs(workflowRunId)
      console.error("Test Failed. Logs of the started workflow:", JSON.stringify(logs, null, 2))
    } catch (error) {
      console.error("Failed to get workflow logs:", error)
    }
    throw error
  }
}

type ExpectType = number | string | object | undefined | void | boolean | null

export const ANY_STRING = '__ANY_STRING_PLACEHOLDER_9d8f7e6c5b4a__'

export const expect = <TObject extends ExpectType = ExpectType>(
  received: TObject,
  expected: TObject
) => {
  // Handle string pattern matching with ANY_STRING
  if (typeof received === 'string' && typeof expected === 'string') {
    const expectedStr = expected as string
    if (expectedStr.includes(ANY_STRING)) {
      const pattern = expectedStr.replace(new RegExp(ANY_STRING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '.*')
      const regex = new RegExp(`^${pattern}$`)
      if (!regex.test(received as string)) {
        throw new Error(`Unexpected value.\n\tReceived "${received}"\n\tExpected pattern "${expected}"`)
      }
      return
    }
  }

  if (received !== expected) {
    throw new Error(`Unexpected value.\n\tReceived "${received}"\n\tExpected "${expected}"`)
  }
}

export const eventually = async function (
  fn: () => Promise<void> | void,
  options: {
    timeout?: number;
    interval?: number;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;

  const startTime = Date.now();

  while (true) {
    try {
      await fn();
      // Success case - all assertions passed
      return;
    } catch (error) {
      const lastError = error as Error;
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Assertions not satisfied within timeout: ${lastError.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
};
