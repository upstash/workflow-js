import { RouteConfigs, TestConfig } from "./types"

export const RETRY_COUNT = 20
export const RETRY_INTERVAL_DURATION = 2000
export const CHECK_WF_AFTER_INIT_DURATION = 10000
const TEST_BUFFER_DURATION = 5000
export const TEST_TIMEOUT_DURATION = (
  CHECK_WF_AFTER_INIT_DURATION
  + (RETRY_COUNT * RETRY_INTERVAL_DURATION)
  + TEST_BUFFER_DURATION
)

export const CI_RANDOM_ID_HEADER = "Ci-Test-Id"
export const CI_ROUTE_HEADER = `Ci-Test-Route`

/**
 * a label header set in the SDK itself to set context.label via client.trigger
 */
export const WORKFLOW_LABEL_HEADER = "upstash-label"

export const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.UPSTASH_WORKFLOW_URL
    ? process.env.UPSTASH_WORKFLOW_URL
    : "http://localhost:3001"

export const TEST_ROUTE_PREFIX = `${BASE_URL}/test-routes`

export const TEST_ROUTES: Pick<TestConfig, RouteConfigs>[] = [
  {
    // tests a very basic endpoint with 2 context run statements
    // payload has unicode chars
    route: "path",
  },
  {
    // same endpoint as path but passes an unknown sdk header
    // which results in one extra request to the endpoint
    route: "path-with-unknown-sdk-header",
  },
  {
    // runs sleep and sleepUntil. checks if sufficient time passed between
    // steps
    route: "sleep",
  },
  {
    // runs sleep parallel with other steps
    route: "sleepWithoutAwait",
  },
  {
    // checks auth
    route: "auth/success",
  },
  {
    // checks auth failing
    route: "auth/fail",
  },
  {
    // checks custom auth
    route: "auth/custom/workflow",
  },
  {
    // checks context.call (sucess and fail case)
    route: "call/workflow",
  },
  {
    // check the error when wf early returns
    route: "returns-before-step",
  },
  {
    // checks context.run with async and sync route methods
    route: "async-sync-run",
  },
  {
    // checks failureFunction
    route: "failureFunction",
  },
  {
    // checks failureFunction with retries: 1
    route: "failureFunction-retry",
  },
  {
    // checks failureFunction with NonRetryableError
    route: "failureFunction-nonRetryable",
  },
  {
    // checks failureUrl
    route: "failureUrl/workflow",
  },
  {
    route: "wait-for-event/workflow",
  },
  {
    route: "call/workflow-with-failureFunction",
  },
  {
    route: "call/workflow-with-failureUrl",
  },
  {
    route: "invoke/workflows/workflowOne",
  },
  {
    route: "trigger-non-workflow/workflow",
  },
  {
    route: "webhook/workflow",
  },
  {
    route: "middleware-logs/workflows/mainWorkflow",
  },
  {
    route: "qstash-trigger-fetch/workflows/mainWorkflow",
  },
  {
    route: "quota-error/workflows/mainWorkflow",
  }

  /**
   * TEST LARGE PAYLOAD CASES
   * 
   * disabled because they are unpredictable in CI.
   * they are checked locally instead.
   */
  // {
  //   route: "large-payload/call-result/workflow",
  // },
  // {
  //   route: "large-payload/error",
  // },
  // {
  //   route: "large-payload/initial",
  // },
  // {
  //   route: "large-payload/step-result",
  // },
  // {
  //   route: "large-payload/step-result-parallel",
  // },
]