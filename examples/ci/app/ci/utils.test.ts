import { test, expect } from "vitest";
import { expect as utilsExpect } from "./utils"

test("expect", () => {
  expect(() => utilsExpect("same", "same")).not.toThrowError()
  expect(() => utilsExpect("not", "same")).toThrowError()
})