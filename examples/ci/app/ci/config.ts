
export type TestConfig<TPayload = unknown> = {
  route: string,
  payload: TPayload,
  headers?: Record<string, string>,
  waitForSeconds: number
}

export const TEST_CONFIG: TestConfig[] = [
  {
    route: "path",
    payload: "my-payload",
    waitForSeconds: 10
  }
]