import { handle } from "@upstash/realtime";
import { realtime } from "@/app/_sdk/realtime";

// SSE endpoint the browser subscribes to. The client (RealtimeProvider)
// connects here by default at /api/realtime.
export const dynamic = "force-dynamic";

export const GET = handle({ realtime });
