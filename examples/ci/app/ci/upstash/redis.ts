import { Redis } from "@upstash/redis";
import { RedisResult } from "../types";
import { expect } from "../utils";
import { type WorkflowContext } from "@upstash/workflow";
import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "../constants";

const redis = Redis.fromEnv();
const EXPIRE_IN_SECS = 60

const getRedisKey = (
  kind: "increment" | "result",
  route: string,
  randomTestId: string
): string => {
  return `wf-${kind}-${route}-${randomTestId}`
}

/**
 * increments the call count for route and randomTestId
 * 
 * @param route route of the test run
 * @param randomTestId randomTestId unique to test run
 */
export const increment = async (route: string, randomTestId: string) => {
  const key = getRedisKey("increment", route, randomTestId)

  const pipe = redis.pipeline()
  pipe.incr(key)
  pipe.expire(key, EXPIRE_IN_SECS)
  await pipe.exec()
}

export const saveResultsWithoutContext = async (
  route: string,
  randomTestId: string,
  result: string,
  overrideCallCount?: number
) => {
  // get call count
  const incrementKey = getRedisKey("increment", route, randomTestId)
  const callCount = overrideCallCount ?? await redis.get<number>(incrementKey) ?? 0

  if (callCount === 0) {
    throw new Error(`callCount shouldn't be 0. It was 0 in test of the route '${route}'`);
  }

  // save result
  const key = getRedisKey("result", route, randomTestId)

  const pipe = redis.pipeline()
  pipe.set<RedisResult>(key, { callCount, result, randomTestId })
  pipe.expire(key, EXPIRE_IN_SECS)
  await pipe.exec()
}

/**
 * saves the result of the workflow to mark the completion of the test
 * 
 * @param context workflow context used
 * @param result result to save which will be checked in the test
 */
export const saveResult = async (
  context: WorkflowContext<unknown>,
  result: string
) => {
  const randomTestId = context.headers.get(CI_RANDOM_ID_HEADER)
  const route = context.headers.get(CI_ROUTE_HEADER)

  if (randomTestId === null) {
    throw new Error("randomTestId can't be null.")
  }
  if (route === null) {
    throw new Error("route can't be null.")
  }

  await saveResultsWithoutContext(
    route,
    randomTestId,
    result
  )
}

export const checkRedisForResults = async (
  route: string,
  randomTestId: string,
  expectedCallCount: number,
  expectedResult: string,
) => {
  const key = getRedisKey("result", route, randomTestId)
  const testResult = await redis.get<RedisResult>(key)
  if (!testResult) {
    throw new Error(`result not found for route ${route} with randomTestId ${randomTestId}`)
  }

  const { callCount, randomTestId: resultRandomTestId, result } = testResult 
  
  expect(resultRandomTestId, randomTestId)
  expect(result, expectedResult)
  expect(callCount, expectedCallCount)
}