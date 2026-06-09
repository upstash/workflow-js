import { Redis } from "@upstash/redis";
import { Realtime } from "@upstash/realtime";
import { realtimeSchema } from "./realtime-schema";

/**
 * Server-side realtime publisher. Agents emit through this; the browser
 * subscribes via the `/api/realtime` route handler (see app/api/realtime).
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment.
 */
export const realtime = new Realtime({
  schema: realtimeSchema,
  redis: Redis.fromEnv(),
});
