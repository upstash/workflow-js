'use client'

import { useEffect, useState } from 'react'
import { CallInfo, ApiResponse } from 'utils/types'
import ResultInfo from './result'
import { costCalc } from 'utils/helper'
import CodeBlock from './codeblock'

export default function CallRegular({
  start = false,
  showCode = false,
}: {
  start?: boolean
  showCode?: boolean
}) {
  const [data, setData] = useState<CallInfo | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState<boolean>(false)

  const onStart = async () => {
    try {
      setLoading(true)
      setError(null)
      setData(null)

      const response = await fetch('/api/regular', {
        method: 'POST',
      })

      const data: ApiResponse = await response.json()

      setData({
        duration: data.time,
        functionTime: data.time,
        result: data.result,
      })
    } catch (e) {
      if (typeof e === 'string') {
        setError(e)
      } else if (e instanceof Error) {
        setError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!start) return
    onStart()
  }, [start])

  return (
    <>
      <legend>Traditional Serverless Function</legend>

      {error && <div>{error}</div>}

      <ResultInfo
        cost={costCalc(data?.functionTime, false)}
        data={data}
        loading={loading}
      />

      <details className="mt-4 bg-zinc-800 text-white" open={showCode}>
        <summary className="block select-none px-2 py-1 text-sm">
          Vercel Function
        </summary>

        <CodeBlock>
          {`
export const POST = async () => {
  // call the mock API
  const req = await fetch(\`\${process.env.VERCEL_URL}/api/mock-api\`, {
    method: 'POST',
  })
  const result = await req.json()

  return new Response(
    JSON.stringify({
      result,
    }),
    { status: 200 },
  )
}
`}
        </CodeBlock>
      </details>
    </>
  )
}
