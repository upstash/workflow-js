import { GET_HEADER, GET_HEADER_VALUE, largeObject } from "../../utils"

export const GET = async () => {
  return new Response(
    largeObject,
    {
      status: 201,
      headers: {
        [ GET_HEADER ]: GET_HEADER_VALUE
      }
    }
  )
}