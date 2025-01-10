import { serve } from '@upstash/workflow/nextjs'
import * as Agents from '@upstash/workflow/agents'
import * as mathjs from 'mathjs'
import { tool } from 'ai'
import { z } from 'zod'

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

export const { POST } = serve<{ prompt: string }>(
  async (context) => {
    const prompt = await context.run('get prompt', () => {
      return context.requestPayload.prompt
    })

    const openai = Agents.createWorkflowOpenAI(context)
    const model = openai('gpt-3.5-turbo')

    const manager = new Agents.ManagerAgent({
      model,
      maxSteps: 3,
      agents: [
        new Agents.Agent({
          tools: {},
          maxSteps: 2,
          background:
            'you are a content creator. make the information provided to you more understandable to the general public',
          name: 'writer',
        }),
        new Agents.Agent({
          tools: {
            calculate: Agents.workflowTool({
              context,
              params: {
                description:
                  'A tool for evaluating mathematical expressions. ' +
                  'Example expressions: ' +
                  "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
                parameters: z.object({ expression: z.string() }),
                // @ts-expect-error can't resolve execute
                execute: async ({ expression }) => mathjs.evaluate(expression),
              },
            }),
          },
          maxSteps: 2,
          background: 'you are a mathematician',
          name: 'mathematician',
        }),
      ],
    })

    const response = await manager.call({ model, prompt })
    // const result2 = await manager.call({ model, prompt2 })

    // const agent = new Agents.Agent({
    //   tools: {},
    //   maxSteps: 2,
    //   background: "you are a content creator. make the information provided to you more understandable to the general public",
    //   name: "writer"
    // })

    // agent.call({model, prompt})

    await context.run('return response', () => {
      const text = response.text
      console.log('text:', text)
      return text
    })
  },
  {
    retries: 0,
    verbose: true,
  },
)
