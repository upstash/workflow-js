"use client";

import { createRealtime } from "@upstash/realtime/client";
import type { RealtimeEvents } from "./realtime";

export const { useRealtime } = createRealtime<RealtimeEvents>();