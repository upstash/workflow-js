import { Realtime, InferRealtimeEvents } from "@upstash/realtime";
import { redis } from "./redis";
import z from "zod/v4";

const schema = {
  workflow: {
    update: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("runStart"),
        workflowRunId: z.string(),
        timestamp: z.number(),
      }),
      z.object({
        type: z.literal("runFinish"),
        workflowRunId: z.string(),
        timestamp: z.number(),
        status: z.enum(["success", "failed"]),
        error: z.string().optional(),
      }),
      z.object({
        type: z.literal("stepStart"),
        workflowRunId: z.string(),
        stepName: z.string(),
        timestamp: z.number(),
      }),
      z.object({
        type: z.literal("stepFinish"),
        workflowRunId: z.string(),
        stepName: z.string(),
        timestamp: z.number(),
        result: z.any().optional(),
      }),
      z.object({
        type: z.literal("stepFail"),
        workflowRunId: z.string(),
        stepName: z.string(),
        timestamp: z.number(),
        error: z.string(),
      }),
      z.object({
        type: z.literal("waitingForInput"),
        workflowRunId: z.string(),
        eventId: z.string(),
        message: z.string(),
        timestamp: z.number(),
      }),
      z.object({
        type: z.literal("inputResolved"),
        workflowRunId: z.string(),
        eventId: z.string(),
        timestamp: z.number(),
      }),
    ]),
  },
};

export const realtime = new Realtime({
  schema,
  redis,
  maxDurationSecs: 300,
});

export type RealtimeEvents = InferRealtimeEvents<typeof realtime>;
