import { NextRequest, NextResponse } from 'next/server'
import { redis } from 'utils/redis'
import { ApiResponse } from 'utils/types'

export const POST = async (request: NextRequest) => {
  const { callKey } = (await request.json()) as { callKey: string }
  const entry = (await redis.getdel(callKey)) as ApiResponse | undefined

  return new NextResponse(JSON.stringify(entry))
}
