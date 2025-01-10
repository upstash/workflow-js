import { serve } from '@upstash/workflow/nextjs'
import * as mathjs from 'mathjs'
import { z } from 'zod'
import { tool } from 'ai'

export const { POST } = serve<{ prompt: string }>(
  async (context) => {
    const prompt = await context.run('get prompt', () => {
      return context.requestPayload.prompt
    })

    const openai = context.agents.getOpenai()
    const model = openai('gpt-3.5-turbo')

    const writerAgent = context.agents.agent({
      model,
      tools: {},
      maxSteps: 2,
      background:
        'you are a content creator. make the information provided to you more understandable to the general public',
      name: 'writer',
    })

    const mathAgent = context.agents.agent({
      model,
      tools: {
        calculate: tool({
          description:
            'A tool for evaluating mathematical expressions. ' +
            'Example expressions: ' +
            "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) => mathjs.evaluate(expression),
        }),
      },
      maxSteps: 2,
      background: 'you are a mathematician',
      name: 'mathematician',
    })

    const response = await context.agents.task({
      agents: [writerAgent, mathAgent],
      prompt,
      maxSteps: 3,
      model,
    })

    await context.run('return response', () => {
      console.log('response:', response)
      return response
    })
  },
  {
    retries: 0,
    verbose: true,
  },
)
