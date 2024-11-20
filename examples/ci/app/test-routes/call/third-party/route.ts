import { FAILING_HEADER_VALUE, FAILING_HEADER, GET_HEADER, GET_HEADER_VALUE } from "../constants";

const thirdPartyResult = "third-party-result";

export const GET = async (request: Request) => {
  return new Response(
    `called GET '${thirdPartyResult}' '${request.headers.get("get-header")}'`,
    {
      status: 200,
      headers: {
        [ GET_HEADER ]: GET_HEADER_VALUE
      }
    }
  )
}

export const POST = async (request: Request) => {

  return new Response(
    `called POST '${thirdPartyResult}' '${request.headers.get("post-header")}' '${await request.text()}'`,
    { status: 201 }
  )
}

export const PATCH = async () => {
  return new Response(
    "failing request",
    {
      status: 401,
      headers: {
        [ FAILING_HEADER ]: FAILING_HEADER_VALUE
      }
    })
}