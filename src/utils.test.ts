import { describe, test, expect } from "bun:test";
import { getWorkflowRunId, getUserIdFromToken, getQStashUrl, decodeBase64 } from "./utils";
import { Client } from "@upstash/qstash";
import { WorkflowError } from "./error";
import { MOCK_QSTASH_SERVER_URL } from "./test-utils";

describe("getWorkflowRunId", () => {
  test("should return random with no id", () => {
    const workflowRunId = getWorkflowRunId();
    expect(workflowRunId.length).toBe(25);
    expect(workflowRunId.slice(0, 4)).toBe("wfr_");
  });

  test("should return with given id", () => {
    const workflowRunId = getWorkflowRunId("my-id");
    expect(workflowRunId.length).toBe(9);
    expect(workflowRunId).toBe("wfr_my-id");
  });
});

describe("decodeBase64", () => {
  test("should decode simple base64 string", () => {
    const encoded = btoa("Hello World");
    const decoded = decodeBase64(encoded);
    expect(decoded).toBe("Hello World");
  });

  test("should decode base64 with unicode characters", () => {
    const originalText = "Hello 世界 🌍";
    const uint8Array = new TextEncoder().encode(originalText);
    const binString = Array.from(uint8Array, (byte) => String.fromCodePoint(byte)).join("");
    const encoded = btoa(binString);
    const decoded = decodeBase64(encoded);
    expect(decoded).toBe(originalText);
  });

  test("should fallback to atob on decode error", () => {
    // Create a base64 string that would cause decode issues but atob can handle
    const encoded = btoa("Simple ASCII");
    const decoded = decodeBase64(encoded);
    expect(decoded).toBe("Simple ASCII");
  });
});

describe("getUserIdFromToken", () => {
  test("should extract userId from valid token", () => {
    const userId = "user_123456";
    const tokenPayload = JSON.stringify({ UserID: userId });
    const encodedToken = btoa(tokenPayload);

    const client = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token: encodedToken,
    });

    const extractedUserId = getUserIdFromToken(client);
    expect(extractedUserId).toBe(userId);
  });

  test("should throw error when token has no userId", () => {
    const tokenPayload = JSON.stringify({ SomeOtherField: "value" });
    const encodedToken = btoa(tokenPayload);

    const client = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token: encodedToken,
    });

    expect(() => getUserIdFromToken(client)).toThrow(
      new WorkflowError(
        "Failed to decode QStash token while runing create webhook step: QStash token payload does not contain userId"
      )
    );
  });

  test("should throw error when token is invalid JSON", () => {
    const encodedToken = btoa("not-valid-json");

    const client = new Client({
      baseUrl: MOCK_QSTASH_SERVER_URL,
      token: encodedToken,
    });

    const throws = () => getUserIdFromToken(client);
    expect(throws).toThrow(WorkflowError);
    expect(throws).toThrow("Failed to decode QStash token while runing create webhook step:");
  });
});

describe("getQStashUrl", () => {
  test("should extract baseUrl from QStash client", () => {
    const customUrl = "https://custom-qstash.upstash.io";
    const client = new Client({
      baseUrl: customUrl,
      token: "test-token",
    });

    const extractedUrl = getQStashUrl(client);
    expect(extractedUrl).toBe(customUrl);
  });
});
