"use client";

import type { ReactNode } from "react";
import { createRealtime, RealtimeProvider } from "@upstash/realtime/client";
import type { RealtimeEvents } from "./realtime-schema";

/**
 * Type-safe `useRealtime` hook bound to the agent event schema.
 * `events` is autocompleted to "agent.start" | "agent.log" | "agent.step" |
 * "agent.finish", and `onData`'s payload is typed per event.
 */
export const { useRealtime } = createRealtime<RealtimeEvents>();

/** Wraps the app so `useRealtime` can open its SSE connection to /api/realtime. */
export function AgentRealtimeProvider({ children }: { children: ReactNode }) {
  return <RealtimeProvider>{children}</RealtimeProvider>;
}
