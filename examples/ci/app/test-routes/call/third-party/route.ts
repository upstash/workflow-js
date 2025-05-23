import { expect } from "app/ci/utils";
import { FAILING_HEADER_VALUE, FAILING_HEADER, GET_HEADER, GET_HEADER_VALUE, PATCH_RESULT, CUSTOM_CONTENT_TYPE, DELETE_RESULT } from "../constants";

const thirdPartyResult = "third-party-result";

export const GET = async (request: Request) => {
  return new Response(
    `called GET '${thirdPartyResult}' '${request.headers.get("get-header")}'`,
    {
      status: 200,
      headers: {
        [GET_HEADER]: GET_HEADER_VALUE
      }
    }
  )
}

export const POST = async (request: Request) => {

  expect(request.headers.get("content-type"), CUSTOM_CONTENT_TYPE);

  return new Response(
    `called POST '${thirdPartyResult}' '${request.headers.get("post-header")}' '${await request.text()}'`,
    { status: 201 }
  )
}

export const PATCH = async () => {
  return new Response(
    PATCH_RESULT.toString(),
    {
      status: 401,
      headers: {
        [FAILING_HEADER]: FAILING_HEADER_VALUE
      }
    }
  )
}

export const DELETE = async () => {
  return new Response(
    JSON.stringify(DELETE_RESULT),
    {
      status: 400
    }
  )
}

export const PUT = async () => {
  return new Response(
    undefined,
    {
      status: 300,
    }
  )
}
