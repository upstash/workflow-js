import { MockResponse } from 'utils/types'

/**
 * This is a mock API that simulates a long-running external
 * APIs like LLMs or AI image generation services etc.
 */
export const POST = async () => {
  await new Promise((r) => setTimeout(r, 1 * 1000))

  return Response.json({
    foo: 'bar',
  } as MockResponse)
}
