import { Client as WorkflowClient } from '@upstash/workflow'
import { NextRequest } from 'next/server'

const client = new WorkflowClient({
  baseUrl: process.env.QSTASH_URL!,
  token: process.env.QSTASH_TOKEN!,
})

export const POST = async (request: NextRequest) => {
  const { route, payload } = (await request.json()) as {
    route: string
    payload: unknown
  }

  console.log('Route:', route)
  console.log('Payload:', payload)

  try {
    const baseUrl =
      process.env.UPSTASH_WORKFLOW_URL ??
      request.url.replace('/-call-qstash', '')

    const { workflowRunId } = await client.trigger({
      url: `${baseUrl}/${route}`,
      body: payload,
      headers: {
        "test": "value"
      }
    })
    await new Promise(r => setTimeout(r, 10000));
    const logs = await client.logs({ workflowRunId })

    return new Response(JSON.stringify({ workflowRunId, logs }), { status: 200 })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Error when publishing to QStash: ${error}` }),
      {
        status: 500,
      },
    )
  }
}
