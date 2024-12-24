import { FetchParameters } from './types'

/**
 * Creates the call parameters for the iamge generation endpoint.
 * 
 * If the OpenAI credentials are set, returns OpenAI info.
 * Otherwise, returns Ideogram credentials if they are set.
 * Finally, returns the mock endpoint of not env vars are set.
 * 
 * @param prompt 
 * @param requestUrl 
 * @returns 
 */
export const getFetchParameters = (
  prompt: string,
  requestUrl: string,
): FetchParameters => {
  if (process.env.OPENAI_API_KEY) {
    return {
      url: 'https://api.openai.com/v1/images/generations',
      method: 'POST',
      body: {
        model: 'dall-e-2',
        prompt,
        n: 1,
        size: '512x512',
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  }

  if (process.env.IDEOGRAM_API_KEY) {
    return {
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
        'Api-Key': process.env.IDEOGRAM_API_KEY,
      },
    }
  }

  console.warn('No credential env var is set. Using placeholder.')
  const mockRoute = "mock-image-gen-endpoint"
  return {
    url: process.env.UPSTASH_WORKFLOW_URL
      ? `${process.env.UPSTASH_WORKFLOW_URL}/api/${mockRoute}`
      : `${requestUrl.split("/").slice(0,-1).join("/")}/${mockRoute}`,
    method: 'POST',
    body: {
      model: 'dall-e-2',
      prompt,
      n: 1,
      size: '512x512',
    },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  }
}
