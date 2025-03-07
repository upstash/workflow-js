import { Suspense } from "react";
import { AgentUI } from "./components/agent-ui";

export default function HomePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AgentUI />
    </Suspense>
  );
}
