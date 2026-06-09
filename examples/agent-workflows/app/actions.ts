"use server";

import { trigger } from "./agents";

/**
 * Kick off the orchestrator and hand the browser back the realtime channel to
 * subscribe to. `trigger` validates the input against the orchestrator's zod
 * schema before dispatching.
 */
export async function startAgent(request: string): Promise<{ channel: string }> {
  const { channel } = await trigger("orchestrator", { request });
  return { channel };
}
