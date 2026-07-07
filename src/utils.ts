import { WorkflowError, WorkflowNonRetryableError } from "./error";
import type { FlowControl } from "@upstash/qstash";
import { WorkflowClient } from "./types";
import { WORKFLOW_LABEL_HEADER } from "./constants";

const NANOID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const NANOID_LENGTH = 21;

const RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9\-_.]+$/;

export function validateLabel(label: string | string[] | undefined): void {
  if (label === undefined) return;

  const labels = Array.isArray(label) ? label : [label];
  if (labels.length === 0) {
    throw new WorkflowNonRetryableError("Invalid label: label array must not be empty.");
  }

  for (const value of labels) {
    if (!RESOURCE_NAME_PATTERN.test(value)) {
      throw new WorkflowNonRetryableError(
        `Invalid label "${value}": must be alphanumeric, hyphen, underscore, or period.`
      );
    }
  }
}

/**
 * Serializes a label (string or array of strings) into the header value.
 * Arrays are joined with `,` so multiple labels can be sent in a single
 * `Upstash-Label` header.
 */
export function serializeLabel(label: string | string[]): string {
  return Array.isArray(label) ? label.join(",") : label;
}

export function validateFlowControl(flowControl: FlowControl | undefined): void {
  if (flowControl?.key !== undefined && !RESOURCE_NAME_PATTERN.test(flowControl.key)) {
    throw new WorkflowNonRetryableError(
      `Invalid flow control key "${flowControl.key}": must be alphanumeric, hyphen, underscore, or period.`
    );
  }
}

function getRandomInt() {
  return Math.floor(Math.random() * NANOID_CHARS.length);
}

/**
 * @param length length of the generated id
 */
export function nanoid(length: number = NANOID_LENGTH): string {
  return Array.from({ length })
    .map(() => NANOID_CHARS[getRandomInt()])
    .join("");
}

/**
 * @param id optional id to use as suffix
 */
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

/**
 * @param qstashClient QStash client to extract user ID from
 */
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

/**
 * @param qstashClient QStash client to extract URL from
 */
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

export function stringifyBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  return JSON.stringify(body);
}

/**
 * Removes headers starting with `Upstash-Workflow-` from the headers
 *
 * @param headers incoming headers
 * @returns headers with `Upstash-Workflow-` headers removed
 */
export const recreateUserHeaders = (headers: Headers): Headers => {
  const filteredHeaders = new Headers();

  const pairs = headers.entries() as unknown as [string, string][];
  for (const [header, value] of pairs) {
    const headerLowerCase = header.toLowerCase();

    const isUserHeader =
      (headerLowerCase !== "upstash-region" &&
        !headerLowerCase.startsWith("upstash-workflow-") &&
        // https://vercel.com/docs/edge-network/headers/request-headers#x-vercel-id
        !headerLowerCase.startsWith("x-vercel-") &&
        !headerLowerCase.startsWith("x-forwarded-") &&
        // https://blog.cloudflare.com/preventing-request-loops-using-cdn-loop/
        headerLowerCase !== "cf-connecting-ip" &&
        headerLowerCase !== "cdn-loop" &&
        headerLowerCase !== "cf-ew-via" &&
        headerLowerCase !== "cf-ray" &&
        // For Render https://render.com
        headerLowerCase !== "render-proxy-ttl") ||
      headerLowerCase === WORKFLOW_LABEL_HEADER.toLocaleLowerCase();

    if (isUserHeader) {
      filteredHeaders.append(header, value);
    }
  }

  return filteredHeaders as Headers;
};
