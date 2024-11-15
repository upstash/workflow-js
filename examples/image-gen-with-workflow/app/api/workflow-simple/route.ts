import { serve } from '@upstash/workflow/nextjs'
import { Redis } from '@upstash/redis'
import { ImageResponse } from 'utils/types'

const redis = Redis.fromEnv()

export const { POST } = serve<{ prompt: string }>(async (context) => {
  // get prompt from request
  const { prompt } = context.requestPayload

  // make the call to Idogram through QStash
  const { body: result } = await context.call(
    'call Ideogram',
    {
      url: 'https://api.ideogram.ai/generate',
      method: 'POST',
      body: {
        image_request: {
          model: 'V_2',
          prompt,
          aspect_ratio: 'ASPECT_1_1',
          magic_prompt_option: 'AUTO',
        },
      },
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': process.env.IDEOGRAM_API_KEY!,
      },
    }
  ) as { body: ImageResponse };

  // save the image url in redis
  // so that UI can access it
  await context.run('save results in redis', async () => {
    await redis.set<string>(
      context.headers.get('callKey')!,
      result.data[0].url,
      { ex: 120 }, // expire in 120 seconds
    )
  })
})
