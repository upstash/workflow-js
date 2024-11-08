import { Client, QstashError } from "@upstash/qstash"
import { TEST_ROUTE_PREFIX, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "../constants"
import { TestConfig } from "../types"

const client = new Client({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

/**
 * starts a workflow run given the config
 * 
 * @param testConfig 
 * @param randomTestId 
 * @returns 
 */
export const startWorkflow = async (
  testConfig: Pick<TestConfig, "route" | "headers" | "payload">,
  randomTestId: string
): Promise<{ messageId: string }> => {
  const result = await client.publishJSON({
    url: `${TEST_ROUTE_PREFIX}/${testConfig.route}`,
    headers: {
      [ CI_RANDOM_ID_HEADER ]: randomTestId,
      [ CI_ROUTE_HEADER ]: testConfig.route,
      ...testConfig.headers
    },
    body: testConfig.payload
  })
  return result
}

/**
 * throws error if workflow hasn't started
 * 
 * @param messageId 
 * @returns 
 */
export const checkWorkflowStart = async (messageId: string) => {

  try {
    const { events } = await client.events({ filter: { messageId }})
    const startMessageDelivered = Boolean(events.find(event => event.state === "DELIVERED"))
    if (!startMessageDelivered) {
      await client.messages.delete(messageId)
      throw new Error(`Couldn't verify that workflow has begun. Number of events: ${events.length}`)
    }
  } catch (error) {
    if (error instanceof QstashError && error.message.includes(`message ${messageId} not found`)) {
      return
    }
    throw error
  }
}