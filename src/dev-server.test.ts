import { describe, expect, test, afterAll, beforeAll, spyOn } from "bun:test";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import {
  ensureDevServer,
  _startServer,
  _resetDevServer,
  getDevCredentials,
  DEV_QSTASH_TOKEN,
  DEV_QSTASH_CURRENT_SIGNING_KEY,
  DEV_QSTASH_NEXT_SIGNING_KEY,
} from "./dev-server";

// Use high ports to avoid conflicts with the mock QStash server on 8080.
const TEST_PORT_INTEGRATION = 19876;
const TEST_PORT_AFTER_RESET = 19877;
const TEST_PORT_DIRECT = 19878;

const CACHE_DIR = join("node_modules", ".cache", "upstash");

function findCachedBinary(): string {
  const dirs = readdirSync(CACHE_DIR) as string[];
  const serverDir = dirs.find((d: string) => d.startsWith("qstash-server-"));
  if (!serverDir) throw new Error("No cached binary found");
  return join(CACHE_DIR, serverDir, "qstash");
}

beforeAll(() => {
  _resetDevServer();

  // Delete any cached QStash binary so we test the full download flow
  if (existsSync(CACHE_DIR)) {
    const dirs = readdirSync(CACHE_DIR) as string[];
    for (const dir of dirs) {
      if (dir.startsWith("qstash-server-")) {
        rmSync(join(CACHE_DIR, dir), { recursive: true, force: true });
      }
    }
  }
});

afterAll(() => {
  _resetDevServer();
});

describe("dev-server", () => {
  describe("getDevCredentials", () => {
    test("should return well-known credentials for a given port", () => {
      const creds = getDevCredentials(8080);
      expect(creds.QSTASH_URL).toBe("http://localhost:8080");
      expect(creds.QSTASH_TOKEN).toBe(DEV_QSTASH_TOKEN);
      expect(creds.QSTASH_CURRENT_SIGNING_KEY).toBe(DEV_QSTASH_CURRENT_SIGNING_KEY);
      expect(creds.QSTASH_NEXT_SIGNING_KEY).toBe(DEV_QSTASH_NEXT_SIGNING_KEY);
    });

    test("should use the provided port in the URL", () => {
      const creds = getDevCredentials(3456);
      expect(creds.QSTASH_URL).toBe("http://localhost:3456");
    });
  });

  describe("ensureDevServer — full integration", () => {
    test(
      "should download binary, cache it, start the server, and log progress",
      async () => {
        const logSpy = spyOn(console, "log");

        const env: Record<string, string | undefined> = {
          WORKFLOW_DEV: "true",
          WORKFLOW_DEV_PORT: String(TEST_PORT_INTEGRATION),
        };

        await ensureDevServer(env);

        // Verify download log was printed
        const logCalls = logSpy.mock.calls.map((call) => call[0]);
        expect(logCalls.some((msg: string) => msg.includes("Downloading QStash server"))).toBe(
          true
        );

        // Verify "running at" log was printed when server started
        expect(logCalls.some((msg: string) => msg.includes("QStash server running at"))).toBe(true);

        // Verify credentials were printed
        expect(logCalls.some((msg: string) => msg.includes("Using credentials"))).toBe(true);

        logSpy.mockRestore();
      },
      { timeout: 60_000 }
    );

    test("should cache the binary on disk after download", () => {
      const dirs = readdirSync(CACHE_DIR) as string[];
      const serverDir = dirs.find((d: string) => d.startsWith("qstash-server-"));
      expect(serverDir).toBeDefined();

      const binaryPath = join(CACHE_DIR, serverDir!, "qstash");
      expect(existsSync(binaryPath)).toBe(true);
    });

    test("should return the same promise on subsequent calls (singleton)", () => {
      const env: Record<string, string | undefined> = {
        WORKFLOW_DEV: "true",
        WORKFLOW_DEV_PORT: String(TEST_PORT_INTEGRATION),
      };

      const p1 = ensureDevServer(env);
      const p2 = ensureDevServer(env);

      expect(p1).toBe(p2);
    });

    test(
      "should start a fresh server after reset on a new port",
      async () => {
        _resetDevServer();

        const logSpy = spyOn(console, "log");

        const env: Record<string, string | undefined> = {
          WORKFLOW_DEV: "true",
          WORKFLOW_DEV_PORT: String(TEST_PORT_AFTER_RESET),
        };

        await ensureDevServer(env);

        const logCalls = logSpy.mock.calls.map((call) => call[0]);
        expect(logCalls.some((msg: string) => msg.includes(String(TEST_PORT_AFTER_RESET)))).toBe(
          true
        );

        logSpy.mockRestore();
      },
      { timeout: 60_000 }
    );
  });

  describe("_startServer — with real binary", () => {
    test(
      "should start server and resolve with cleanup function",
      async () => {
        _resetDevServer();
        await new Promise((r) => setTimeout(r, 500));

        const binaryPath = findCachedBinary();
        const cleanup = await _startServer(binaryPath, TEST_PORT_DIRECT);

        expect(cleanup).toBeFunction();
        cleanup();
      },
      { timeout: 30_000 }
    );
  });

  describe("serve integration with WORKFLOW_DEV", () => {
    test("serveBase injects dev credentials and creates handler when WORKFLOW_DEV=true", async () => {
      const { serveBase } = await import("./serve/index");

      // With WORKFLOW_DEV=true, serveBase should NOT throw at construction
      // time even without QSTASH_TOKEN, because dev credentials are injected
      const { handler } = serveBase(
        async (context) => {
          await context.sleep("test-sleep", 1);
        },
        undefined,
        {
          env: {
            WORKFLOW_DEV: "true",
            WORKFLOW_DEV_PORT: "19890",
          } as unknown as Record<string, string>,
        }
      );

      expect(handler).toBeFunction();
    });

    test("serveBase processes options eagerly when WORKFLOW_DEV is not set", async () => {
      const { serveBase } = await import("./serve/index");

      const { handler } = serveBase(
        async (context) => {
          await context.sleep("test-sleep", 1);
        },
        undefined,
        {
          env: {
            QSTASH_TOKEN: "test-token",
          } as unknown as Record<string, string>,
        }
      );

      expect(handler).toBeFunction();
    });

    test("dev credentials do not overwrite user-provided values", () => {
      const env: Record<string, string | undefined> = {
        QSTASH_TOKEN: "user-provided-token",
        QSTASH_URL: undefined,
      };

      const creds = getDevCredentials(8080);

      // Apply the same merge logic used in serveBase
      for (const [k, v] of Object.entries(creds)) {
        if (!env[k]) {
          env[k] = v;
        }
      }

      // User-provided QSTASH_TOKEN should be preserved
      expect(env.QSTASH_TOKEN).toBe("user-provided-token");
      // Missing values should be filled from dev credentials
      expect(env.QSTASH_URL).toBe("http://localhost:8080");
      expect(env.QSTASH_CURRENT_SIGNING_KEY).toBe(DEV_QSTASH_CURRENT_SIGNING_KEY);
      expect(env.QSTASH_NEXT_SIGNING_KEY).toBe(DEV_QSTASH_NEXT_SIGNING_KEY);
    });
  });
});
