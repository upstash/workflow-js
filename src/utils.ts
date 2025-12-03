import { WorkflowError } from "./error";
import { WorkflowClient } from "./types";

const NANOID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const NANOID_LENGTH = 21;

function getRandomInt() {
  return Math.floor(Math.random() * NANOID_CHARS.length);
}

export function nanoid(length: number = NANOID_LENGTH): string {
  return Array.from({ length })
    .map(() => NANOID_CHARS[getRandomInt()])
    .join("");
}

export function getWorkflowRunId(id?: string): string {
  return `wfr_${id ?? nanoid()}`;
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
  const binString = atob(base64);
  try {
    // @ts-expect-error m will always be defined
    const intArray = Uint8Array.from(binString, (m) => m.codePointAt(0));
    return new TextDecoder().decode(intArray);
  } catch (error) {
    // this error should never happen essentially. It's only a failsafe
    console.warn(
      `Upstash Qstash: Failed while decoding base64 "${base64}".` +
        ` Decoding with atob and returning it instead. ${error}`
    );
    return binString;
  }
}

export function getUserIdFromToken(qstashClient: WorkflowClient): string {
  try {
    const token = (qstashClient as WorkflowClient & { token: string }).token;
    const decodedToken = decodeBase64(token);
    const tokenPayload = JSON.parse(decodedToken) as { UserID: string };
    const userId = tokenPayload.UserID;

    if (!userId) {
      throw new WorkflowError("QStash token payload does not contain userId");
    }
    return userId;
  } catch (error) {
    throw new WorkflowError(
      `Failed to decode QStash token while running create webhook step: ${(error as Error).message}`
    );
  }
}

export function getQStashUrl(qstashClient: WorkflowClient): string {
  try {
    const requester = qstashClient.http;
    const baseUrl = (requester as typeof requester & { baseUrl: string }).baseUrl;

    if (!baseUrl) {
      throw new WorkflowError("QStash client does not have a baseUrl");
    }
    return baseUrl;
  } catch (error) {
    throw new WorkflowError(`Failed to get QStash URL from client: ${(error as Error).message}`);
  }
}

export function getEventId(): string {
  return `evt_${nanoid(15)}`;
}
