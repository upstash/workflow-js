export const GET = async () => {
  return new Response(
    JSON.stringify({ message: "middleware-logs-endpoint-result" }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  )
}
