

export const GET = async () => {
  console.log(import.meta.env);
  return new Response("what", { status: 200 })
}