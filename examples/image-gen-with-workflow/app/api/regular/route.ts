export const maxDuration = 30

/**
 * Route which calls Ideogram directly
 *
 * The code here is essentially the same code as the one shown in the
 * UI. On top of the code on the UI, it has:
 * - some logic to calculate the running time of the Vercel Function for each workflow.
 * - ratelimiting with @upstash/ratelimit
 */
import { NextRequest, NextResponse } from 'next/server'
import { ratelimit, validateRequest } from 'utils/redis'
import { getFetchParameters } from 'utils/request'
import { CallPayload, ImageResponse, Prompt, RedisEntry } from 'utils/types'
import { IMAGES, MOCK_WAIT_MS, PROMPTS, RATELIMIT_CODE } from 'utils/constants'

export const POST = async (request: NextRequest) => {
  // check the ratelimit
  const response = await validateRequest(request, ratelimit)
  if (response.status === RATELIMIT_CODE) return response

  // record the start time and get the prompt
  const t1 = performance.now()
  const params = (await request.json()) as CallPayload
  const promptIndex = params.promptIndex
  const prompt = PROMPTS[promptIndex]

  // call Ideogram and record the time
  const url = await makeRequest(prompt)
  const time = performance.now() - t1

  // return the results in the same format as how Worklow saves
  // them in redis
  const result: RedisEntry = {
    time,
    url,
  }

  return new NextResponse(JSON.stringify(result), { status: 200 })
}

/**
 * Calls Ideogram to get an image and returns its URL
 *
 * @param prompt prompt to use
 * @returns image url
 */
const makeRequest = async (prompt: Prompt) => {
  // get parameters for fetch
  const parameters = getFetchParameters(prompt)

  if (!parameters) {
    // Exists for development purposes.
    // if the parameters are not present, return a mock image
    // after waiting for MOCK_WAIT_MS.
    await new Promise((r) => setTimeout(r, MOCK_WAIT_MS))
    return IMAGES[prompt]
  }

  // make the fetch request
  const response = await fetch(parameters.url, {
    method: parameters.method,
    body: JSON.stringify(parameters.body),
    headers: parameters.headers,
  })

  // return the response
  const data = (await response.json()) as ImageResponse
  return data.data[0].url
}
