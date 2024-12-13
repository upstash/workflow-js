export const runtime = 'nodejs';

import { serve } from '@upstash/workflow/nextjs'

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

export const { POST } = serve<string>(async (context) => {
  const input = context.requestPayload
  const result1 = await context.run('step1', async () => {
    console.log(someWork(input));
  })
}, {
})
