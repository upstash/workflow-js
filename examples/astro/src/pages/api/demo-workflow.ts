import { serve } from "@upstash/workflow/astro";

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

export const { POST } = serve<{ url: string }>(async (context) => {
  const input = context.requestPayload.url
  const result1 = await context.run('step1', async () => {
    const output = someWork(input)
    console.log('step 1 input', input, 'output', output)
    return output
  })

  await context.run('step2', async () => {
    const output = someWork(result1)
    console.log('step 2 input', result1, 'output', output)
  })
}, {
  // env must be passed in astro.
  // for local dev, we need import.meta.env.
  // For deployment, we need process.env:
  env: {
    ...process.env,
    ...import.meta.env
  }
})