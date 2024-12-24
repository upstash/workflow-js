import { NextRequest } from "next/server"
import { IMAGES, MOCK_WAIT_MS } from "utils/constants"
import { ImageResponse, Prompt } from "utils/types"


export const POST = async (request: NextRequest) => {
  const params = (await request.json()) as { prompt: Prompt }
  
  const prompt = params.prompt

  await new Promise((r) => setTimeout(r, MOCK_WAIT_MS))
  const response: ImageResponse = {
    created: "mock",
    data: [
      {
        prompt,
        url: IMAGES[prompt]
      }
    ]
  }
  return new Response(JSON.stringify(response))
}
