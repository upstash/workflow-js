import { serve } from '@upstash/workflow/nextjs'

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

const { POST: handler } = serve<string>(async (context) => {
  const input = context.requestPayload
  const result1 = await context.run('step1', async () => {
    const output = someWork(input)
    console.log('step 1 input', input, 'output', output)
    return output
  })

  await context.run('step2', async () => {
    const output = someWork(result1)
    console.log('step 2 input', result1, 'output', output)
  })
})


export const POST = async (request: Request) => {
  const body = await request.text()

  // console.log("ENV", process.env);
  // console.log("HEADERS", request.headers);
  console.log("BODY", body);

  return await handler(new Request(
    request.url,
    {
      body: body,
      headers: request.headers,
      method: "POST"
    }
  ))
}