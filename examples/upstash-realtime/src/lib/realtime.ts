import { Realtime, InferRealtimeEvents } from "@upstash/realtime";
import { redis } from "./redis";
import z from "zod/v4";

const schema = {
  workflow: {
    runFinish: z.object({}),
    stepFinish: z.object({
      stepName: z.string(),
      result: z.unknown().optional()
    }),
    waitingForInput: z.object({
      eventId: z.string(),
      message: z.string()
    }),
    inputResolved: z.object({
      eventId: z.string()
    }),
  }
}

export const realtime = new Realtime({ schema, redis })
export type RealtimeEvents = InferRealtimeEvents<typeof realtime>