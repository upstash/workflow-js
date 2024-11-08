import { TestConfig } from "./types"

export const CI_RANDOM_ID_HEADER = "CI_TEST_ID"
export const CI_ROUTE_HEADER = `CI_TEST_ROUTE`

export const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.UPSTASH_WORKFLOW_URL
    ? process.env.UPSTASH_WORKFLOW_URL
    : "http://localhost:3001"

export const TEST_ROUTE_PREFIX = `${BASE_URL}/test-routes`

export const TEST_ROUTES: Pick<TestConfig, "route" | "waitForSeconds">[] = [
  {
    route: "path",
    waitForSeconds: 1
  },
  {
    route: "sleep",
    waitForSeconds: 8
  },
  {
    route: "sleepWithoutAwait",
    waitForSeconds: 18
  },
]