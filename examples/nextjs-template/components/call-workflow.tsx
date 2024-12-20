import { useEffect, useState } from 'react'
import { costCalc, generateCallKey } from 'utils/helper'
import { CallInfo, ApiResponse } from 'utils/types'
import ResultInfo from './result'
import CodeBlock from './codeblock'

async function checkRedisForResult(callKey: string) {
  const response = await fetch('/api/check-workflow', {
    method: 'POST',
    body: JSON.stringify({ callKey }),
  })

  const result: ApiResponse = await response.json()
  return result
}

export default function CallWorkflow({
  start = false,
  showCode = false,
}: {
  start?: boolean
  showCode?: boolean
}) {
  const [data, setData] = useState<CallInfo | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const callKey = generateCallKey()

  const onStart = async () => {
    try {
      setLoading(true)
      setError(null)
      setData(null)

      await fetch('/api/workflow', {
        method: 'POST',
        headers: {
          callKey,
        },
      })

      pollData()
    } catch (e) {
      if (typeof e === 'string') {
        setError(e)
      } else if (e instanceof Error) {
        setError(e.message)
      }
    }
  }

  const pollData = async () => {
    const startTime = performance.now()
    let checkCount = 0

    while (true) {
      const result = await checkRedisForResult(callKey)

      if (result) {
        setData({
          duration: performance.now() - startTime,
          functionTime: Number(result.time),
          result: result.result,
        })
        setLoading(false)
        break
      }

      checkCount++
      if (checkCount > 45) {
        setError('Workflow request got timeout. Please try again later.')
        setLoading(false)
        break
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  useEffect(() => {
    if (!start) return
    onStart()
  }, [start])

  return (
    <>
      <legend>Serverless Function with Upstash Workflow</legend>

      {error && <div>{error}</div>}

      <ResultInfo
        cost={costCalc(data?.functionTime, true)}
        data={data}
        loading={loading}
      />

      <details className="mt-4 bg-zinc-800 text-white" open={showCode}>
        <summary className="block select-none px-2 py-1 text-sm">
          Workflow Function
        </summary>
        <CodeBlock>
          {`
import { serve } from '@upstash/workflow/nextjs'
import { redis } from 'utils/redis'
import { ApiResponse, MockResponse } from 'utils/types'

const baseUrl = process.env.UPSTASH_WORKFLOW_URL ?? process.env.VERCEL_URL

export const { POST } = serve(async (context) => {
  const { body } = await context.call<MockResponse>('call mock-api', {
    url: \`\${baseUrl}/api/mock-api\`,
    method: 'POST',
  })

  await context.run('save results in redis', async () => {
    // get callKey from headers
    const callKey = context.headers.get('callKey')
    if (!callKey) {
      console.warn('Failed to get the call key from headers')
      return
    }

    // save the final time key and result
    await redis.set<ApiResponse>(
      callKey,
      {
        result: body,
      },
      { ex: 120 },
    )
  })
})

`.trim()}
        </CodeBlock>
      </details>
    </>
  )
}
