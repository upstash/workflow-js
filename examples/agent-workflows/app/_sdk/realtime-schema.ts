import { z } from "zod";

/**
 * The set of events every agent broadcasts over the course of a run.
 *
 * Each running agent emits on a channel named after the *root* workflow run id,
 * so a whole orchestrator + sub-agent tree shows up on a single channel and the
 * UI can render one unified live feed.
 */
export const realtimeSchema = {
  agent: {
    /** Emitted once when an agent starts working. */
    start: z.object({ agent: z.string() }),
    /** The agent narrating its own reasoning via the built-in `log` tool. */
    log: z.object({ agent: z.string(), message: z.string() }),
    /** Emitted by the SDK after every durable workflow step. */
    step: z.object({ agent: z.string(), stepName: z.string() }),
    /** Emitted once when an agent finishes, with its final answer. */
    finish: z.object({ agent: z.string(), text: z.string() }),
  },
};

// The client hook is typed from the schema shape (zod types at the leaves),
// which is how @upstash/realtime derives event paths and per-event payloads.
export type RealtimeEvents = typeof realtimeSchema;
