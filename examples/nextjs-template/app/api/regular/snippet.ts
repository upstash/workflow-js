export const POST = async () => {
  // call the mock API
  const req = await fetch(`${process.env.VERCEL_URL}/api/mock-api`, {
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
