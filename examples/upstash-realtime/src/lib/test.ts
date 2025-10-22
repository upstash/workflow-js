import { Realtime, InferRealtimeEvents } from "@upstash/realtime"
import { redis } from "./redis"
import z from "zod/v4"

const schema = {
  notification: {
    alert: z.string(),
  },
}

export const realtime = new Realtime({ schema, redis })
export type RealtimeEvents = InferRealtimeEvents<typeof realtime>

export const POST = async () => {
  await realtime.emit("notification.alert", "hello world!")

  return new Response("OK")
}