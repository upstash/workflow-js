/**
 * plain endpoint used as the context.call target of the
 * flow-control/call test workflow
 */
export const POST = async () => {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
