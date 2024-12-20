import { JSONValue } from 'hono/utils/types'

export type CallInfo = {
  duration: number
  result: JSONValue
  functionTime: number
}

export type ApiResponse = {
  time: number
  result: JSONValue
}

export type MockResponse = {
  foo: 'bar'
}
