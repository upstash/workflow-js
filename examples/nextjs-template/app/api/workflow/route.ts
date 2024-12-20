import { serve } from '@upstash/workflow/nextjs'

import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { redis } from 'utils/redis'
import { MockResponse, ApiResponse } from 'utils/types'

/**
 * Route which calls the long running API using Upstash Workflow.
 * Additional wrapper code is added to calculate the running time of the workflow.
 */
export const POST = async (request: NextRequest) => {
  const t1 = performance.now()

  // call the serve method of the workflow
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
const { POST: serveMethod } = serve(async (context) => {
  const { body } = await context.call<MockResponse>('call mock-api', {
    url: `${new URL(context.url).origin}/api/mock-api`,
    method: 'POST',
  })

  await context.run('save results in redis', async () => {
    // get callKey from headers
    const callKey = context.headers.get('callKey')
    if (!callKey) {
      console.warn('Failed to get the call key from headers')
      return
    }

    // get and delete the time key
    const time = await redis.getdel<number | undefined>(getTimeKey(callKey))

    // save the final time key and result
    await redis.set<ApiResponse>(
      callKey,
      {
        time: time ?? 0,
        result: body,
      },
      { ex: 120 },
    )
  })
})

// get key to store the time for each workflow run
const getTimeKey = (key: string) => `time-${key}`
