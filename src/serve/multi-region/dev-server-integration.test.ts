// End-to-end test: spawns the QStash dev-server binary and runs `serve()` with
// no real credentials, just QSTASH_DEV=true.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@upstash/qstash";
import { serve } from "..";

const INTEGRATION_PORT = "8383";

describe("workflow dev server integration", () => {
  let listener: ReturnType<typeof Bun.serve>;
  let workflowUrl: string;
  let handler: (request: Request) => Promise<Response>;
  let client: Client;
  const ranSteps: string[] = [];
  const delivered: { signature: string; body: string; url: string }[] = [];

  beforeAll(() => {
    process.env.QSTASH_DEV = "true";
    process.env.QSTASH_DEV_PORT = INTEGRATION_PORT;

    listener = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const signature = request.headers.get("upstash-signature");
        if (signature) {
          delivered.push({ signature, body: await request.clone().text(), url: request.url });
        }
        return handler(request);
      },
    });
    workflowUrl = `http://127.0.0.1:${listener.port}/workflow`;

    handler = serve(
      async (context) => {
        const greeting = await context.run("step1", () => {
          ranSteps.push(`step1:${context.requestPayload as string}`);
          return `hello ${context.requestPayload as string}`;
        });
        await context.run("step2", () => {
          ranSteps.push(`step2:${greeting}`);
          return greeting.toUpperCase();
        });
      },
      { url: workflowUrl }
    ).handler;
  });

  afterAll(() => {
    listener.stop(true);
    delete process.env.QSTASH_DEV;
    delete process.env.QSTASH_DEV_PORT;
  });

  const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !predicate()) await Bun.sleep(100);
  };

  const isDevServerReachable = async () => {
    try {
      // Any HTTP response (even an error status) means the dev server is up.
      await fetch(`http://127.0.0.1:${INTEGRATION_PORT}`);
      return true;
    } catch {
      return false;
    }
  };

  const waitForAsync = async (predicate: () => Promise<boolean>, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(await predicate())) await Bun.sleep(100);
  };

  test(
    "dev server is reachable after serve() and before any inbound request",
    async () => {
      // The only thing that has run is serve() in beforeAll — no workflow request
      // has been published yet. This is the new eager-start guarantee.
      await waitForAsync(isDevServerReachable);
      expect(await isDevServerReachable()).toBe(true);
    },
    { timeout: 60_000 }
  );

  test(
    "multi-step workflow: every dev-server delivery verifies and steps run in order",
    async () => {
      ranSteps.length = 0;
      client = new Client({ devMode: true });
      const { messageId } = await client.publishJSON({ url: workflowUrl, body: "world" });
      expect(messageId).toBeTruthy();

      await waitFor(() => ranSteps.length >= 2);
      expect(ranSteps).toEqual(["step1:world", "step2:hello world"]);
    },
    { timeout: 60_000 }
  );

  test("direct unsigned POST is rejected, proves the dev-mode receiver is engaged", async () => {
    ranSteps.length = 0;
    const response = await handler(
      new Request(workflowUrl, { method: "POST", body: JSON.stringify("smuggled") })
    );
    expect(response.status).not.toBe(200);
    expect(ranSteps).toEqual([]);
  });

  test("tampered body on a real dev-server delivery is rejected", async () => {
    expect(delivered.length).toBeGreaterThan(0); // populated by the multi-step test
    const real = delivered[0];

    const replay = await handler(
      new Request(real.url, {
        method: "POST",
        headers: { "upstash-signature": real.signature },
        body: real.body + "TAMPERED",
      })
    );
    expect(replay.status).not.toBe(200);
  });
});
