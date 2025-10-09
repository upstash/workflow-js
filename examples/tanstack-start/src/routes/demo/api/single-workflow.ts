import { createFileRoute } from '@tanstack/react-router'
import { serve } from '@upstash/workflow/tanstack'

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

export const Route = createFileRoute('/demo/api/single-workflow')({
  server: {
    handlers: serve<string>(async (context) => {
      const input = context.requestPayload
      const result1 = await context.run('step1', () => {
        const output = someWork(input)
        console.log('step 1 input', input, 'output', output)
        return output
      })

      await context.run('step2', () => {
        const output = someWork(result1)
        console.log('step 2 input', result1, 'output', output)
      })
    }),
  },
})
