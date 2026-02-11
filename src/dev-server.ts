import { execSync, spawn } from "child_process";
import { createWriteStream, existsSync, mkdirSync, chmodSync } from "fs";
import { get as httpsGetRaw } from "https";
import { get as httpGetRaw } from "http";
import { join } from "path";
import { tmpdir } from "os";

export type DevServerCredentials = {
  QSTASH_URL: string;
  QSTASH_TOKEN: string;
  QSTASH_CURRENT_SIGNING_KEY: string;
  QSTASH_NEXT_SIGNING_KEY: string;
};

/**
 * The QStash dev server always uses these fixed credentials.
 */
export const DEV_QSTASH_TOKEN =
  "eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=";
export const DEV_QSTASH_CURRENT_SIGNING_KEY = "sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r";
export const DEV_QSTASH_NEXT_SIGNING_KEY = "sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs";

/**
 * Returns the well-known dev credentials for a given port.
 */
export function getDevCredentials(port: number): DevServerCredentials {
  return {
    QSTASH_URL: `http://localhost:${port}`,
    QSTASH_TOKEN: DEV_QSTASH_TOKEN,
    QSTASH_CURRENT_SIGNING_KEY: DEV_QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY: DEV_QSTASH_NEXT_SIGNING_KEY,
  };
}

const CACHE_DIR = join("node_modules", ".cache", "upstash");

function getPlatformArch(): { platform: string; arch: string } {
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return { platform, arch };
}

function httpsGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string) => {
      httpsGetRaw(currentUrl, { headers: { "User-Agent": "upstash-workflow" } }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    };
    request(url);
  });
}

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string) => {
      httpsGetRaw(currentUrl, { headers: { "User-Agent": "upstash-workflow" } }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
        file.on("error", reject);
      }).on("error", reject);
    };
    request(url);
  });
}

async function resolveLatestVersion(): Promise<string> {
  const data = await httpsGet("https://api.github.com/repos/upstash/qstash-cli/releases/latest");
  const json = JSON.parse(data.toString()) as { tag_name: string };
  return json.tag_name;
}

async function ensureBinary(): Promise<string> {
  const version = await resolveLatestVersion();
  const cacheDir = join(CACHE_DIR, `qstash-server-${version}`);
  const binaryPath = join(cacheDir, "qstash");

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const { platform, arch } = getPlatformArch();
  const downloadUrl = `https://artifacts.upstash.com/qstash/versions/${version}/qstash-server_${version}_${platform}_${arch}.tar.gz`;

  console.log(`[workflow-dev] Downloading QStash server...`);

  mkdirSync(cacheDir, { recursive: true });
  const tempFile = join(tmpdir(), `qstash-server-${version}-${Date.now()}.tar.gz`);

  await downloadToFile(downloadUrl, tempFile);
  execSync(`tar -xzf "${tempFile}" -C "${cacheDir}"`);
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function startServer(binaryPath: string, port: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["dev", "-port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;

    const cleanup = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });

    let stdoutBuffer = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdoutBuffer += text;

      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.match(/runn+ing at/) && !resolved) {
          resolved = true;
          const creds = getDevCredentials(port);
          console.log(`[workflow-dev] QStash server running at ${creds.QSTASH_URL}`);
          console.log(
            `[workflow-dev] View logs at \x1b[1;32mhttps://console.upstash.com/workflow/local-mode-user/logs\x1b[0m`
          );
          resolve(cleanup);
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      if (!resolved) {
        process.stderr.write(`[workflow-dev] ${text}`);
      }
    });

    child.on("error", (err) => {
      if (!resolved) {
        reject(new Error(`[workflow-dev] Failed to start QStash server: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        reject(
          new Error(`[workflow-dev] QStash server exited with code ${code} before becoming ready`)
        );
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error("[workflow-dev] QStash server did not become ready within 30 seconds"));
      }
    }, 30_000);
  });
}

/**
 * Checks if a QStash dev server is already running on the given port
 * by hitting GET /v2/keys and validating the response contains the
 * expected signing keys.
 */
function isDevServerRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGetRaw(
      `http://127.0.0.1:${port}/v2/keys`,
      {
        headers: { Authorization: `Bearer ${DEV_QSTASH_TOKEN}` },
        timeout: 2000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              current?: string;
              next?: string;
            };
            resolve(
              body.current === DEV_QSTASH_CURRENT_SIGNING_KEY &&
                body.next === DEV_QSTASH_NEXT_SIGNING_KEY
            );
          } catch {
            resolve(false);
          }
        });
        res.on("error", () => resolve(false));
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

let serverPromise: Promise<void> | null = null;
let serverCleanup: (() => void) | null = null;

/**
 * Ensures the local QStash dev server is running.
 * Uses a singleton pattern so multiple serve() calls share one server.
 * If the port is already in use (e.g. started by another process), skips starting.
 * Resolves when the server is ready to accept requests.
 *
 * @param environment - The environment record (process.env or equivalent)
 */
export function ensureDevServer(environment: Record<string, string | undefined>): Promise<void> {
  if (!serverPromise) {
    const port = Number(environment.WORKFLOW_DEV_PORT) || 8080;
    serverPromise = isDevServerRunning(port).then((alreadyRunning) => {
      if (alreadyRunning) {
        return;
      }
      return ensureBinary()
        .then((binaryPath) => startServer(binaryPath, port))
        .then((cleanup) => {
          serverCleanup = cleanup;
        });
    });
  }
  return serverPromise;
}

/**
 * Returns a promise that resolves when the dev server is ready.
 * If ensureDevServer was never called (i.e. not in dev mode), resolves immediately.
 * This allows the Client to wait for the server without needing to know the environment.
 */
export function waitForDevServer(): Promise<void> {
  return serverPromise ?? Promise.resolve();
}

/** @internal — exported for testing only */
export { startServer as _startServer };

/** @internal — stop the running server and reset singleton state for testing */
export function _resetDevServer(): void {
  if (serverCleanup) {
    serverCleanup();
    serverCleanup = null;
  }
  serverPromise = null;
}
