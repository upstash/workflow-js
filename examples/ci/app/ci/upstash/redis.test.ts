
import { describe, test, expect, beforeAll } from "bun:test";
import * as redis from "./redis"
import { nanoid } from "../utils";

describe("redis", () => {
  test("should throw on missing results", () => {
    expect(() =>
      redis.checkRedisForResults("some-route", "some-id", -1, "some-result")
    ).toThrow(
      "result not found for route some-route with randomTestId some-id"
    )
  })

  test("should throw when saving results without any increment", () => {
    expect(() =>
      redis.saveResultsWithoutContext("some-route", "some-id", "some-result")
    ).toThrow(
      "callCount shouldn't be 0. It was 0 in test of the route 'some-route'"
    )
  })

  describe("after two increments and saving results", () => {

    const route = "two-inrement-route"
    const randomId = `random-id-${nanoid()}`
    const result = `random-result-${nanoid()}`

    beforeAll(async () => {
      await redis.increment(route, randomId)
      await redis.increment(route, randomId)
      await redis.saveResultsWithoutContext(route, randomId, result)
    })

    test("should throw on mismatching result", () => {
      expect(async () =>
        redis.checkRedisForResults(route, randomId, 2, "not-correct")
      ).toThrow(
        `Unexpected value.\n\tReceived "${result}"\n\tExpected "not-correct"`
      )
    })

    test("should throw on mismatching call count", () => {
      expect(async () =>
        redis.checkRedisForResults(route, randomId, 123, result)
      ).toThrow(
        `Unexpected value.\n\tReceived "2"\n\tExpected "123"`
      )
    })

    test("should not throw on correct results", () => {
      expect(async () =>
        redis.checkRedisForResults(route, randomId, 2, result)
      ).not.toThrow()
    })
  })

  test("should override call count", async () => {

    const route = "override-route"
    const randomId = `random-id-${nanoid()}`
    const result = `random-result-${nanoid()}`
    const override = -3

    await redis.increment(route, randomId)
    await redis.increment(route, randomId)
    await redis.increment(route, randomId)

    await redis.saveResultsWithoutContext(route, randomId, result, override)

    expect(async () =>
      redis.checkRedisForResults(route, randomId, 3, result)
    ).toThrow(
      `Unexpected value.\n\tReceived "-3"\n\tExpected "3"`
    )

    test("should not throw on correct results", () => {
      expect(async () =>
        redis.checkRedisForResults(route, randomId, override, result)
      ).not.toThrow()
    })
  })
})