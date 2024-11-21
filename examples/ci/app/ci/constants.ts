import { TestConfig } from "./types"

export const CI_RANDOM_ID_HEADER = "Ci-Test-Id"
export const CI_ROUTE_HEADER = `Ci-Test-Route`

export const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.UPSTASH_WORKFLOW_URL
    ? process.env.UPSTASH_WORKFLOW_URL
    : "http://localhost:3001"

export const TEST_ROUTE_PREFIX = `${BASE_URL}/test-routes`

export const TEST_ROUTES: Pick<TestConfig, "route" | "waitForSeconds">[] = [
  {
    // tests a very basic endpoint with 2 context run statements
    // payload has unicode chars
    route: "path",
    waitForSeconds: 1
  },
  {
    // runs sleep and sleepUntil. checks if sufficient time passed between
    // steps
    route: "sleep",
    waitForSeconds: 8
  },
  {
    // runs sleep parallel with other steps
    route: "sleepWithoutAwait",
    waitForSeconds: 18
  },
  {
    // checks auth
    route: "auth/success",
    waitForSeconds: 1
  },
  {
    // checks auth failing
    route: "auth/fail",
    waitForSeconds: 0
  },
  {
    // checks custom auth
    route: "auth/custom/workflow",
    waitForSeconds: 5
  },
  {
    // checks context.call (sucess and fail case)
    route: "call/workflow",
    waitForSeconds: 24
  },
  {
    // checks context.run with async and sync route methods
    route: "async-sync-run",
    waitForSeconds: 1
  },
  {
    // checks failureFunction
    route: "failureFunction",
    waitForSeconds: 1
  },
  {
    // checks failureFunction with retries: 1
    route: "failureFunction-retry",
    waitForSeconds: 14
  },
  {
    // checks failureUrl
    route: "failureUrl/workflow",
    waitForSeconds: 1
  },
  {
    route: "wait-for-event/workflow",
    waitForSeconds: 20
  },
  {
    route: "call/workflow-with-failureFunction",
    waitForSeconds: 5
  },
  {
    route: "call/workflow-with-failureUrl",
    waitForSeconds: 5
  },
  
  /**
   * TEST LARGE PAYLOAD CASES
   * 
   * disabled because they are unpredictable in CI.
   * they are checked locally instead.
   */
  // {
  //   route: "large-payload/call-result/workflow",
  //   waitForSeconds: 9
  // },
  // {
  //   route: "large-payload/error",
  //   waitForSeconds: 9
  // },
  // {
  //   route: "large-payload/initial",
  //   waitForSeconds: 9
  // },
  // {
  //   route: "large-payload/step-result",
  //   waitForSeconds: 6
  // },
  // {
  //   route: "large-payload/step-result-parallel",
  //   waitForSeconds: 12
  // },
]