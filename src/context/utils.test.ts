import { describe, test, expect } from "bun:test";
import { parseResponseBody } from "./utils";

describe("parseResponseBody", () => {
  describe("text content types", () => {
    test("should parse JSON body from application/json response", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ message: "hello", count: 42 }) });
      const result = await parseResponseBody(out, "application/json");
      expect(result).toEqual({ message: "hello", count: 42 });
    });

    test("should parse JSON body from text/plain response", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ data: "test" }) });
      const result = await parseResponseBody(out, "text/plain");
      expect(result).toEqual({ data: "test" });
    });

    test("should return plain text body if not valid JSON", async () => {
      const out = JSON.stringify({ body: "plain text content" });
      const result = await parseResponseBody(out, "text/plain");
      expect(result).toBe("plain text content");
    });

    test("should handle application/xml content type", async () => {
      const xmlContent = "<root><item>value</item></root>";
      const out = JSON.stringify({ body: xmlContent });
      const result = await parseResponseBody(out, "application/xml");
      expect(result).toBe(xmlContent);
    });

    test("should handle application/javascript content type", async () => {
      const jsContent = "console.log('hello');";
      const out = JSON.stringify({ body: jsContent });
      const result = await parseResponseBody(out, "application/javascript");
      expect(result).toBe(jsContent);
    });

    test("should handle application/x-www-form-urlencoded content type", async () => {
      const formData = "key1=value1&key2=value2";
      const out = JSON.stringify({ body: formData });
      const result = await parseResponseBody(out, "application/x-www-form-urlencoded");
      expect(result).toBe(formData);
    });

    test("should handle application/xhtml+xml content type", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ xhtml: true }) });
      const result = await parseResponseBody(out, "application/xhtml+xml");
      expect(result).toEqual({ xhtml: true });
    });

    test("should handle application/ld+json content type", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ "@context": "schema" }) });
      const result = await parseResponseBody(out, "application/ld+json");
      expect(result).toEqual({ "@context": "schema" });
    });

    test("should handle application/rss+xml content type", async () => {
      const rssContent = '<?xml version="1.0"?><rss></rss>';
      const out = JSON.stringify({ body: rssContent });
      const result = await parseResponseBody(out, "application/rss+xml");
      expect(result).toBe(rssContent);
    });

    test("should handle application/atom+xml content type", async () => {
      const atomContent = '<?xml version="1.0"?><feed></feed>';
      const out = JSON.stringify({ body: atomContent });
      const result = await parseResponseBody(out, "application/atom+xml");
      expect(result).toBe(atomContent);
    });

    test("should handle text/html content type", async () => {
      const htmlContent = "<html><body>Hello</body></html>";
      const out = JSON.stringify({ body: htmlContent });
      const result = await parseResponseBody(out, "text/html");
      expect(result).toBe(htmlContent);
    });

    test("should handle text/css content type", async () => {
      const cssContent = "body { color: red; }";
      const out = JSON.stringify({ body: cssContent });
      const result = await parseResponseBody(out, "text/css");
      expect(result).toBe(cssContent);
    });

    test("should handle content-type with charset parameter", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ message: "hello" }) });
      const result = await parseResponseBody(out, "application/json; charset=utf-8");
      expect(result).toEqual({ message: "hello" });
    });

    test("should handle unicode characters in body", async () => {
      const unicodeContent = "Hello world";
      const out = JSON.stringify({ body: unicodeContent });
      const result = await parseResponseBody(out, "text/plain");
      expect(result).toBe(unicodeContent);
    });

    test("should handle nested JSON objects", async () => {
      const nestedData = {
        level1: {
          level2: {
            level3: "deep value",
          },
        },
      };
      const out = JSON.stringify({ body: JSON.stringify(nestedData) });
      const result = await parseResponseBody(out, "application/json");
      expect(result).toEqual(nestedData);
    });

    test("should handle arrays in JSON body", async () => {
      const arrayData = [1, 2, 3, { nested: "value" }];
      const out = JSON.stringify({ body: JSON.stringify(arrayData) });
      const result = await parseResponseBody(out, "application/json");
      expect(result).toEqual(arrayData);
    });

    test("should handle empty string body", async () => {
      const out = JSON.stringify({ body: "" });
      const result = await parseResponseBody(out, "text/plain");
      expect(result).toBe("");
    });
  });

  describe("non-text content types", () => {
    test("should return unchanged for null content type", async () => {
      const binaryData = "binary-data-string";
      const result = await parseResponseBody(binaryData, null);
      expect(result).toBe(binaryData);
    });

    test("should return unchanged for application/octet-stream", async () => {
      const binaryData = "binary-data-string";
      const result = await parseResponseBody(binaryData, "application/octet-stream");
      expect(result).toBe(binaryData);
    });

    test("should return unchanged for image/png", async () => {
      const imageData = "image-binary-data";
      const result = await parseResponseBody(imageData, "image/png");
      expect(result).toBe(imageData);
    });

    test("should return unchanged for image/jpeg", async () => {
      const imageData = "jpeg-binary-data";
      const result = await parseResponseBody(imageData, "image/jpeg");
      expect(result).toBe(imageData);
    });

    test("should return unchanged for video/mp4", async () => {
      const videoData = "video-binary-data";
      const result = await parseResponseBody(videoData, "video/mp4");
      expect(result).toBe(videoData);
    });

    test("should return unchanged for audio/mpeg", async () => {
      const audioData = "audio-binary-data";
      const result = await parseResponseBody(audioData, "audio/mpeg");
      expect(result).toBe(audioData);
    });

    test("should return unchanged for application/pdf", async () => {
      const pdfData = "pdf-binary-data";
      const result = await parseResponseBody(pdfData, "application/pdf");
      expect(result).toBe(pdfData);
    });

    test("should return unchanged for application/zip", async () => {
      const zipData = "zip-binary-data";
      const result = await parseResponseBody(zipData, "application/zip");
      expect(result).toBe(zipData);
    });
  });

  describe("edge cases", () => {
    test("should handle empty content-type header", async () => {
      const data = "some-data";
      const result = await parseResponseBody(data, "");
      expect(result).toBe(data);
    });

    test("should handle content-type with multiple parameters", async () => {
      const out = JSON.stringify({ body: JSON.stringify({ test: true }) });
      const result = await parseResponseBody(
        out,
        "application/json; charset=utf-8; boundary=something"
      );
      expect(result).toEqual({ test: true });
    });

    test("should handle malformed JSON in processedResult", async () => {
      // This should throw an error because JSON.parse(processedResult) will fail
      const malformedOut = "not-valid-json";
      await expect(parseResponseBody(malformedOut, "application/json")).rejects.toThrow();
    });
  });
});
