import { InferRealtimeEvents, Realtime } from "@upstash/realtime"
import { UIMessageChunk } from "ai"
import z from "zod/v4"
import { redis } from "./redis"

export const schema = {
  ai: { chunk: z.any() as z.ZodType<UIMessageChunk> },
}

export const realtime = new Realtime({ schema, redis })
export type RealtimeEvents = InferRealtimeEvents<typeof realtime>
