"use client";

import { useState } from "react";
import { startAgent } from "./actions";
import { useRealtime } from "./_sdk/realtime-client";

type FeedItem =
  | { kind: "start"; agent: string }
  | { kind: "log"; agent: string; message: string }
  | { kind: "step"; agent: string; stepName: string }
  | { kind: "finish"; agent: string; text: string };

const AGENT_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  researcher: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  writer: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export default function Home() {
  const [request, setRequest] = useState("Explain why the sky is blue.");
  const [channel, setChannel] = useState<string>();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);

  const { status } = useRealtime({
    enabled: Boolean(channel),
    channels: channel ? [channel] : [],
    events: ["agent.start", "agent.log", "agent.step", "agent.finish"],
    onData({ event, data }) {
      if (event === "agent.start") {
        setFeed((f) => [...f, { kind: "start", agent: data.agent }]);
      } else if (event === "agent.log") {
        setFeed((f) => [...f, { kind: "log", agent: data.agent, message: data.message }]);
      } else if (event === "agent.step") {
        setFeed((f) => [...f, { kind: "step", agent: data.agent, stepName: data.stepName }]);
      } else if (event === "agent.finish") {
        setFeed((f) => [...f, { kind: "finish", agent: data.agent, text: data.text }]);
        if (data.agent === "orchestrator") setRunning(false);
      }
    },
  });

  async function run() {
    setFeed([]);
    setChannel(undefined);
    setRunning(true);
    const { channel } = await startAgent(request);
    setChannel(channel);
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Agent SDK demo
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            An orchestrator delegates to a researcher and a writer. Watch them
            think, step, and delegate in real time.
          </p>
        </header>

        <div className="flex gap-2">
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Ask the agents something…"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            onClick={run}
            disabled={running || !request.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>

        {channel && (
          <p className="text-xs text-zinc-500">
            channel <code>{channel.slice(0, 8)}…</code> · {status}
          </p>
        )}

        <ol className="flex flex-col gap-2">
          {feed.map((item, i) => (
            <FeedRow key={i} item={item} />
          ))}
          {running && feed.length === 0 && (
            <li className="text-sm text-zinc-500">Waiting for the first event…</li>
          )}
        </ol>
      </main>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const badge = (
    <span
      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
        AGENT_COLORS[item.agent] ?? "bg-zinc-200 text-zinc-700"
      }`}
    >
      {item.agent}
    </span>
  );

  if (item.kind === "finish") {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          {badge}
          <span className="text-xs font-medium text-zinc-500">finished</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-black dark:text-zinc-100">
          {item.text}
        </p>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      {badge}
      {item.kind === "start" && (
        <span className="text-zinc-500">started working</span>
      )}
      {item.kind === "log" && (
        <span className="text-black dark:text-zinc-200">💭 {item.message}</span>
      )}
      {item.kind === "step" && (
        <span className="text-zinc-400">⚙️ {item.stepName}</span>
      )}
    </li>
  );
}
