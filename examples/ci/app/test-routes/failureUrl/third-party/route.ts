import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants"
import { saveResultsWithoutContext } from "app/ci/upstash/redis"
import { expect } from "app/ci/utils"
import { ERROR_MESSAGE, HEADER, HEADER_VALUE } from "../constants"

export const POST = async (request: Request) => {
  const result = await request.json() as {
    body: string,
    header: Record<string, string[]>,
    sourceHeader: Record<string, string[]>,
    workflowRunId: string
  }
  
  const errorMessage = atob(result.body)
  expect(errorMessage, `{"error":"Error","message":"${ERROR_MESSAGE}"}`)
  expect(result.sourceHeader[HEADER][0], HEADER_VALUE)

  // get id and route
  const randomTestId = result.sourceHeader[CI_RANDOM_ID_HEADER][0]
  const route = result.sourceHeader[CI_ROUTE_HEADER][0]

  await saveResultsWithoutContext(
    route, randomTestId, errorMessage
  )

  return new Response("", { status: 200 })
}