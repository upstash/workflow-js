import { NextResponse } from 'next/server'

/**
 * Route which calls the long running API directly
 */
export const POST = async () => {
  // record the start time and get the prompt
  const t1 = performance.now()

  // call the mock API
  const req = await fetch(`${process.env.VERCEL_URL}/api/mock-api`, {
    method: 'POST',
  })
  const result = await req.json()
  const time = performance.now() - t1

  return new NextResponse(
    JSON.stringify({
      result,
      time,
    }),
    { status: 200 },
  )
}
