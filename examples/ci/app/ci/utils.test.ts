import { test, expect } from "vitest";
import { expect as utilsExpect } from "./utils"

test("expect", () => {
  expect(() => utilsExpect("same", "same")).not.toThrow()
  expect(() => utilsExpect("not", "same")).toThrow(`Unexpected value.\n\tReceived "not"\n\tExpected "same"`)
})