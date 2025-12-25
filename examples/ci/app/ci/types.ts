import { FlowControl } from "@upstash/qstash"

export type TriggerConfig = {
  retries?: number,
  retryDelay?: string,
  flowControl?: FlowControl,
  failureUrl?: string,
  label?: string
}

export type TestConfig<TPayload = unknown> = {
  /**
   * path of the workflow endpoint
   * 
   * will also be part of the redis key
   */
  route: string,
  /**
   * payload to send in the initial request
   */
  payload: TPayload,
  /**
   * headers of the request
   */
  headers?: Record<string, string>,
  /**
   * number of times the endpoint is to be called in this test
   */
  expectedCallCount: number
  /**
   * expected result in the Redis
   */
  expectedResult: string
  /**
   * whether the workflow should start
   * 
   * @default true
   */
  shouldWorkflowStart?: boolean
  /**
   * run trigger config
   */
  triggerConfig?: TriggerConfig
}

/**
 * configs derived from the test endpoints instead of the constants file
 */
export type RouteConfigs = "route"

export type RedisResult = {
  /**
   * observed call count
   */
  callCount: number
  /**
   * result written to redis
   */
  result: string
  /**
   * a randomly generated string which is generated
   * in each test and sent as a header.
   */
  randomTestId: string
}
