const textContentTypes = [
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/xhtml+xml",
  "application/ld+json",
  "application/rss+xml",
  "application/atom+xml",
];

const isText = (contentTypeHeader: string | null) => {
  if (!contentTypeHeader) {
    return false;
  }
  if (textContentTypes.some((type) => contentTypeHeader.includes(type))) {
    return true;
  }
  if (contentTypeHeader.startsWith("text/")) {
    return true;
  }
  return false;
};

/**
 * Parses and decodes response body from workflow step results.
 *
 * This function is used internally to process the `out` field from step results,
 * particularly when dealing with text-based content types. It handles proper
 * character encoding by converting the string to a Uint8Array and then decoding
 * it using TextDecoder to support unicode characters.
 *
 * The function determines how to parse based on the content-type header:
 * - For text content types (JSON, XML, text/*, etc.): Decodes the string properly,
 *   extracts the body field from the parsed JSON, and attempts to parse it as JSON.
 *   If the body is not valid JSON, returns it as-is.
 * - For non-text content types (binary, etc.): Returns the output unchanged.
 *
 * @param out - The output string from the step result to be parsed
 * @param contentTypeHeader - The content-type header from the response, used to
 *   determine parsing strategy. Can be null for non-text responses.
 * @returns The parsed response body. For text responses, attempts to parse as JSON
 *   and falls back to the raw string. For binary responses, returns unchanged.
 *
 * @example
 * // Text response with JSON body
 * const result = await parseResponseBody(
 *   '{"body": "{\\"message\\": \\"hello\\"}"}',
 *   'application/json'
 * );
 * // Returns: { message: "hello" }
 *
 * @example
 * // Text response with non-JSON body
 * const result = await parseResponseBody(
 *   '{"body": "plain text"}',
 *   'text/plain'
 * );
 * // Returns: "plain text"
 *
 * @example
 * // Binary response
 * const result = await parseResponseBody(
 *   'binary-data',
 *   'application/octet-stream'
 * );
 * // Returns: "binary-data"
 */
export const parseResponseBody = async (out: string, contentTypeHeader: string | null) => {
  if (isText(contentTypeHeader)) {
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) {
      bytes[i] = out.charCodeAt(i);
    }

    const processedResult = new TextDecoder().decode(bytes);
    const newBody = JSON.parse(processedResult).body;

    try {
      return JSON.parse(newBody);
    } catch {
      return newBody;
    }
  } else {
    return out;
  }
};
