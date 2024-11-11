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
    route: "auth",
    waitForSeconds: 1
  },
  {
    // checks auth failing
    route: "auth-fail",
    waitForSeconds: 0
  },
  {
    // checks context.call (sucess and fail case)
    route: "call/workflow",
    waitForSeconds: 16
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
  }
]