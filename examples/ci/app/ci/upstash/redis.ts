import { Redis } from "@upstash/redis";
import { RedisResult } from "../types";
import { expect } from "../utils";

const redis = Redis.fromEnv();

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
  pipe.expire(key, 100)
  await pipe.exec()
}

/**
 * saves the result of the workflow to mark the completion of the test
 * 
 * @param route route of the test run
 * @param randomTestId id unique to test run. will throw if null
 * @param result result to save which will be checked in the test
 */
export const saveResult = async (
  route: string,
  randomTestId: string | null,
  result: string
) => {
  if (randomTestId === null) {
    throw new Error("randomTestId can't be null.")
  }
  // get call count
  const incrementKey = getRedisKey("increment", route, randomTestId)
  const callCount = await redis.get<number>(incrementKey) ?? 0

  if (callCount === 0) {
    throw new Error(`callCount shouldn't be 0. It was 0 in test of the route '${route}'`);
  }

  // save result
  const key = getRedisKey("result", route, randomTestId)

  const pipe = redis.pipeline()
  pipe.set<RedisResult>(key, { callCount, result, randomTestId })
  pipe.expire(key, 100)
  await pipe.exec()
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