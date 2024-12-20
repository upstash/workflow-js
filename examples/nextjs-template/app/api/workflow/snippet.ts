import { serve } from '@upstash/workflow/nextjs'
import { redis } from 'utils/redis'
import { ApiResponse, MockResponse } from 'utils/types'

const baseUrl = process.env.UPSTASH_WORKFLOW_URL ?? process.env.VERCEL_URL

export const { POST } = serve(async (context) => {
  const { body } = await context.call<MockResponse>('call mock-api', {
    url: `${baseUrl}/api/mock-api`,
    method: 'POST',
  })

  await context.run('save results in redis', async () => {
    // get callKey from headers
    const callKey = context.headers.get('callKey')
    if (!callKey) {
      console.warn('Failed to get the call key from headers')
      return
    }

    // save the final time key and result
    await redis.set<ApiResponse>(
      callKey,
      // @ts-expect-error for snippet
      {
        result: body,
      },
      { ex: 120 },
    )
  })
})
