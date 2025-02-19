
export const GET = async (request: Request) => {
  console.log(request.headers);
  return new Response(JSON.stringify({}), { status: 200 });

}