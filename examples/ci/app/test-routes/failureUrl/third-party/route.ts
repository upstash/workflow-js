import { CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER } from "app/ci/constants"
import { saveResultsWithoutContext } from "app/ci/upstash/redis"
import { expect } from "app/ci/utils"
import { ERROR_MESSAGE, HEADER, HEADER_VALUE } from "../constants"

export const POST = async (request: Request) => {
  const result = await request.json() as {
    body: string,
    header: Record<string, string[]>,
    workflowRunId: string
  }

  const errorMessage = atob(result.body)
  expect(errorMessage, `{"error":"Error","message":"${ERROR_MESSAGE}"}`)
  expect(request.headers.get(HEADER), HEADER_VALUE)

  // get id and route
  const randomTestId = request.headers.get(CI_RANDOM_ID_HEADER)
  const route = request.headers.get(CI_ROUTE_HEADER)

  if (!route || !randomTestId || !errorMessage) {
    throw new Error(`failed to get route, randomTestId or errorMessage. route: ${route}, randomTestId: ${randomTestId}, errorMessage: ${errorMessage}`)
  }

  await saveResultsWithoutContext(
    route, randomTestId, errorMessage
  )

  return new Response("", { status: 200 })
}