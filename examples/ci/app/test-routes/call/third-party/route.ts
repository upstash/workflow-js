
const thirdPartyResult = "third-party-result";

export const GET = async (request: Request) => {
  return new Response(
    `called GET '${thirdPartyResult}' '${request.headers.get("get-header")}'`,
    { status: 200 }
  )
}

export const POST = async (request: Request) => {

  return new Response(
    `called POST '${thirdPartyResult}' '${request.headers.get("post-header")}' '${await request.text()}'`,
    { status: 200 }
  )
}

export const PATCH = async () => {
  return new Response("failing request", { status: 401 })
}