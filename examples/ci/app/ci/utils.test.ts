import { test, expect } from "bun:test";
import { expect as utilsExpect, ANY_STRING } from "./utils"

test("expect - basic equality", () => {
  expect(() => utilsExpect("same", "same")).not.toThrow()
  expect(() => utilsExpect("not", "same")).toThrow(`Unexpected value.\n\tReceived "not"\n\tExpected "same"`)
})

test("expect - ANY_STRING pattern matching", () => {
  // Test basic ANY_STRING replacement
  expect(() => utilsExpect("hello world", `hello ${ANY_STRING}`)).not.toThrow()
  expect(() => utilsExpect("test123", `test${ANY_STRING}`)).not.toThrow()
  expect(() => utilsExpect("prefix-suffix", `prefix${ANY_STRING}suffix`)).not.toThrow()
  
  // Test multiple ANY_STRING patterns
  expect(() => utilsExpect(`user-123-data`, `user${ANY_STRING}data`)).not.toThrow()
  expect(() => utilsExpect("id_abc_def_end", `id${ANY_STRING}end`)).not.toThrow()
  
  // Test empty string matching
  expect(() => utilsExpect("start", `start${ANY_STRING}`)).not.toThrow()
  expect(() => utilsExpect("end", `${ANY_STRING}end`)).not.toThrow()
  
  // Test full string replacement
  expect(() => utilsExpect("anything", `${ANY_STRING}`)).not.toThrow()
})

test("expect - ANY_STRING pattern failures", () => {
  // Should fail when pattern doesn't match
  expect(() => utilsExpect("hello world", `goodbye ${ANY_STRING}`))
    .toThrow(`Unexpected value.\n\tReceived "hello world"\n\tExpected pattern "goodbye ${ANY_STRING}"`)
  
  expect(() => utilsExpect("test", `testing${ANY_STRING}`))
    .toThrow(`Unexpected value.\n\tReceived "test"\n\tExpected pattern "testing${ANY_STRING}"`)
  
  expect(() => utilsExpect("prefix-wrong", `prefix${ANY_STRING}suffix`))
    .toThrow(`Unexpected value.\n\tReceived "prefix-wrong"\n\tExpected pattern "prefix${ANY_STRING}suffix"`)
})

test("expect - non-string types", () => {
  // Numbers
  expect(() => utilsExpect(42, 42)).not.toThrow()
  expect(() => utilsExpect(42, 43)).toThrow(`Unexpected value.\n\tReceived "42"\n\tExpected "43"`)
  
  // Booleans
  expect(() => utilsExpect(true, true)).not.toThrow()
  expect(() => utilsExpect(true, false)).toThrow(`Unexpected value.\n\tReceived "true"\n\tExpected "false"`)
  
  // Null and undefined
  expect(() => utilsExpect(null, null)).not.toThrow()
  expect(() => utilsExpect(undefined, undefined)).not.toThrow()
  expect(() => utilsExpect(null, undefined)).toThrow(`Unexpected value.\n\tReceived "null"\n\tExpected "undefined"`)
  
  // Objects
  const obj1 = { a: 1 }
  const obj2 = { a: 1 }
  expect(() => utilsExpect(obj1, obj1)).not.toThrow() // Same reference
  expect(() => utilsExpect(obj1, obj2)).toThrow() // Different references
})