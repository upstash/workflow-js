const NANOID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const NANOID_LENGTH = 21;

import crypto from "node:crypto";

export function nanoid() {
  return [...crypto.getRandomValues(new Uint8Array(NANOID_LENGTH))]
    .map((x) => NANOID_CHARS[x % NANOID_CHARS.length])
    .join("");
}

/**
 * When the base64 string has unicode characters, atob doesn't decode
 * them correctly since it only outputs ASCII characters. Therefore,
 * instead of using atob, we properly decode them.
 *
 * If the decoding into unicode somehow fails, returns the result of atob
 *
 * https://developer.mozilla.org/en-US/docs/Glossary/Base64#the_unicode_problem
 *
 * @param base64 encoded string
 */
export function decodeBase64(base64: string) {
  try {
    const binString = atob(base64);
    // @ts-expect-error m will always be defined
    const intArray = Uint8Array.from(binString, (m) => m.codePointAt(0));
    return new TextDecoder().decode(intArray);
  } catch (error) {
    // this error should never happen essentially. It's only a failsafe
    console.warn(
      `Upstash Qstash: Failed while decoding base64 "${base64}".` +
        ` Decoding with atob and returning it instead. ${error}`
    );
    return atob(base64);
  }
}
