// One catch-all-style route serves every agent. `serveMany` (inside
// serveAgents) routes the request to the right agent using the last path
// segment, e.g. POST /api/agents/orchestrator -> the orchestrator agent.
export { POST } from "@/app/agents";
