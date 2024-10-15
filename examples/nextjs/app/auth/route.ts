import { serve } from '@upstash/workflow/nextjs'

export const POST = serve<string>(async (context) => {
  if (context.headers.get('authentication') !== 'Bearer secretPassword') {
    console.error('Authentication failed.')
    return
  }

  await context.run('step1', async () => {
    return 'output 1'
  })

  await context.run('step2', async () => {
    return 'output 2'
  })
})
