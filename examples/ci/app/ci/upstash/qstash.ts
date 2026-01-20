import { Client as WorkflowClient } from "@upstash/workflow"
import { TEST_ROUTE_PREFIX, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "../constants"
import { TestConfig } from "../types"

const workflowClient = new WorkflowClient({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

/**
 * starts a workflow run given the config
 * 
 * @param testConfig 
 * @param randomTestId 
 * @returns 
 */
export const startWorkflow = async (
  testConfig: Pick<TestConfig, "route" | "headers" | "payload" | "triggerConfig">,
  randomTestId: string
): Promise<{ workflowRunId: string }> => {
  const result = await workflowClient.trigger({
    url: `${TEST_ROUTE_PREFIX}/${testConfig.route}`,
    headers: {
      [ CI_RANDOM_ID_HEADER ]: randomTestId,
      [ CI_ROUTE_HEADER ]: testConfig.route,
      ...testConfig.headers
    },
    retryDelay: testConfig.triggerConfig?.retryDelay,
    retries: testConfig.triggerConfig?.retries,
    flowControl: testConfig.triggerConfig?.flowControl,
    failureUrl: testConfig.triggerConfig?.failureUrl,
    label: testConfig.triggerConfig?.label,
    body: testConfig.payload,
  })
  return result
}

export const getWorkflowLogs = async (workflowRunId: string) => {
  const results = await workflowClient.logs({ workflowRunId })
  return results
}
