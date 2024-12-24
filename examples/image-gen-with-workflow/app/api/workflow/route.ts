/**
 * Route which calls Ideogram using Upstash Workflow
 *
 * The code here is essentially the same code as the one shown in the
 * UI. On top of the code on the UI, it has:
 * - some logic to calculate the running time of the Vercel Function for each workflow.
 * - ratelimiting with @upstash/ratelimit
 */
import { serve } from '@upstash/workflow/nextjs'

import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { ratelimit, redis, validateRequest } from 'utils/redis'
import { getFetchParameters } from 'utils/request'
import { CallPayload, ImageResponse, RedisEntry } from 'utils/types'
import { PROMPTS, RATELIMIT_CODE } from 'utils/constants'

// get key to store the time for each workflow run
const getTimeKey = (key: string) => `time-${key}`

export const POST = async (request: NextRequest) => {
  // check the ratelimit
  const response = await validateRequest(request, ratelimit)
  if (response.status === RATELIMIT_CODE) return response

  // record the start time and run the workflow serve method
  const t1 = performance.now()
  
  const result = await serveMethod(request)

  // get the workflow run identifier header
  // which is included in the request in workflow-call.tsx
  const key = request.headers.get('callKey')

  if (key) {
    // calculate the duration
    const duration = performance.now() - t1

    // increment the time key by the duration
    const pipe = redis.pipeline()
    const timeKey = getTimeKey(key)
    pipe.incrbyfloat(timeKey, duration)
    pipe.expire(timeKey, 120) // expire in 120 seconds
    waitUntil(pipe.exec())
  } else {
    console.warn(
      "callKey header was missing. couldn't log the time for the call.",
    )
  }

  // return workflow response
  return result
}

/**
 * Workflow serve method. Usually, it's possible to assign it directly
 * to POST like:
 *
 * ```ts
 * export const POST = serve(...)
 * ```
 *
 * See docs to learn more https://upstash.com/docs/qstash/workflow/basics/serve
 */
const { POST: serveMethod } = serve<CallPayload>(async (context) => {
  // get prompt from payload
  const payload = context.requestPayload
  const prompt = PROMPTS[payload.promptIndex]

  // get parameters for context.call
  const parameters = getFetchParameters(prompt, context.url)

  // if the parameters are present, make context.call request
  // to call Ideogram through QStash
  const { body } = await context.call<ImageResponse>(
    'call image generation API',
    parameters
  );

  await context.run('save results in redis', async () => {
    // get callKey from headers
    const callKey = context.headers.get('callKey')
    if (!callKey) {
      console.warn('Failed to get the call key from headers')
      return
    }

    // save the final time key and result
    await redis.set<RedisEntry>(
      callKey,
      {
        time: (await redis.get(getTimeKey(callKey))) ?? 0,
        url: body.data[0].url,
      },
      { ex: 120 },
    ) // expire in 120 seconds

    // remove the time key from redis
    await redis.del(getTimeKey(callKey))
  })
})
