"use client";

import { useEffect, useRef, useState } from "react";
import { startAgent } from "./actions";
import { useRealtime } from "./_sdk/realtime-client";

type FeedItem =
  | { kind: "start"; agent: string }
  | { kind: "log"; agent: string; message: string }
  | { kind: "step"; agent: string; stepName: string }
  | { kind: "finish"; agent: string; text: string };

type AgentMeta = {
  label: string;
  emoji: string;
  avatar: string; // gradient for the avatar
  dot: string; // solid accent (status dot / rail)
  text: string; // accent text
  soft: string; // tinted surface
  border: string;
};

const AGENTS: Record<string, AgentMeta> = {
  orchestrator: {
    label: "Orchestrator",
    emoji: "🧭",
    avatar: "from-violet-500 to-fuchsia-500",
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-300",
    soft: "bg-violet-50 dark:bg-violet-500/10",
    border: "border-violet-200 dark:border-violet-500/20",
  },
  researcher: {
    label: "Researcher",
    emoji: "🔬",
    avatar: "from-sky-500 to-cyan-500",
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-300",
    soft: "bg-sky-50 dark:bg-sky-500/10",
    border: "border-sky-200 dark:border-sky-500/20",
  },
  writer: {
    label: "Writer",
    emoji: "✍️",
    avatar: "from-emerald-500 to-teal-500",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-300",
    soft: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-200 dark:border-emerald-500/20",
  },
};

const FALLBACK: AgentMeta = {
  label: "Agent",
  emoji: "🤖",
  avatar: "from-zinc-500 to-zinc-600",
  dot: "bg-zinc-500",
  text: "text-zinc-600 dark:text-zinc-300",
  soft: "bg-zinc-100 dark:bg-zinc-800/60",
  border: "border-zinc-200 dark:border-zinc-700",
};

const meta = (agent: string) => AGENTS[agent] ?? FALLBACK;

const EXAMPLES = [
  "Explain why the sky is blue.",
  "Summarize how vaccines work.",
  "What makes sourdough bread rise?",
];

type Group = { agent: string; items: FeedItem[] };

function groupFeed(feed: FeedItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of feed) {
    const last = groups.at(-1);
    if (last && last.agent === item.agent) last.items.push(item);
    else groups.push({ agent: item.agent, items: [item] });
  }
  return groups;
}

export default function Home() {
  const [request, setRequest] = useState(EXAMPLES[0]);
  const [channel, setChannel] = useState<string>();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  // Elapsed-time ticker while a run is in flight.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => clearInterval(id);
  }, [running]);

  // Keep the latest activity in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.length]);

  async function run() {
    if (!request.trim() || running) return;
    setFeed([]);
    setChannel(undefined);
    setElapsed(0);
    startedAt.current = Date.now();
    setRunning(true);
    try {
      const { channel } = await startAgent(request);
      setChannel(channel);
    } catch {
      setRunning(false);
    }
  }

  const groups = groupFeed(feed);
  const finishes = feed.filter(
    (i): i is Extract<FeedItem, { kind: "finish" }> => i.kind === "finish"
  );
  const orchestratorFinish = [...finishes]
    .reverse()
    .find((f) => f.agent === "orchestrator");
  // Prefer the orchestrator's own answer; if it returned no text, fall back to
  // the most recent non-empty result (e.g. the writer's prose).
  const answerText =
    orchestratorFinish?.text.trim() ||
    [...finishes].reverse().find((f) => f.text.trim().length > 0)?.text.trim() ||
    "";
  const hasStarted = Boolean(channel) || feed.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center bg-linear-to-b from-zinc-50 to-zinc-100 dark:from-black dark:to-zinc-950">
      <main className="flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-12 sm:py-16">
        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-emerald-400 to-teal-500 text-lg shadow-sm shadow-emerald-500/30">
              ✦
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Agent SDK
              </h1>
              <p className="text-xs font-medium text-zinc-500">
                durable multi-agent workflows · live
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            An <span className="font-medium text-violet-600 dark:text-violet-300">orchestrator</span>{" "}
            delegates to a{" "}
            <span className="font-medium text-sky-600 dark:text-sky-300">researcher</span> and a{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-300">writer</span>, each
            narrating its work in real time.
          </p>
        </header>

        {/* Composer */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="Ask the agents something…"
              className="flex-1 rounded-xl bg-transparent px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
            />
            <button
              onClick={run}
              disabled={running || !request.trim()}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-500"
            >
              {running ? (
                <>
                  <Spinner /> Running
                </>
              ) : (
                <>Run ↵</>
              )}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1 pt-1.5 pb-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setRequest(ex)}
                disabled={running}
                className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:text-zinc-300"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Run meta bar */}
        {hasStarted && (
          <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
            <div className="flex items-center gap-3">
              <ConnectionPill status={status} running={running} />
              {channel && (
                <span className="font-mono text-zinc-400">{channel.slice(0, 8)}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{elapsed.toFixed(1)}s</span>
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  checked={showSteps}
                  onChange={(e) => setShowSteps(e.target.checked)}
                  className="size-3 accent-emerald-500"
                />
                steps
              </label>
            </div>
          </div>
        )}

        {/* Activity feed */}
        <ol className="flex flex-col gap-3">
          {groups.map((group, gi) => {
            const isLastGroup = gi === groups.length - 1;
            return (
              <AgentCard
                key={gi}
                group={group}
                showSteps={showSteps}
                working={running && isLastGroup}
              />
            );
          })}

          {running && feed.length === 0 && (
            <li className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-400 dark:border-zinc-800">
              <Spinner /> Spinning up the workflow…
            </li>
          )}

          {!hasStarted && (
            <li className="rounded-2xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800">
              Enter a prompt and hit <span className="font-medium">Run</span> to watch the
              agents work.
            </li>
          )}
        </ol>

        {/* Final answer (rendered where the orchestrator finishes) */}
        {orchestratorFinish && (
          <div className="animate-in rounded-2xl border border-emerald-200 bg-linear-to-b from-emerald-50 to-white p-5 shadow-sm dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-zinc-900">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-300">
              <span>✓</span> Answer
            </div>
            {answerText ? (
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">
                {answerText}
              </p>
            ) : (
              <p className="text-sm text-zinc-400">
                The orchestrator finished without returning any text.
              </p>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}

function AgentCard({
  group,
  showSteps,
  working,
}: {
  group: Group;
  showSteps: boolean;
  working: boolean;
}) {
  const m = meta(group.agent);
  const done = group.items.some((i) => i.kind === "finish");
  const logs = group.items.filter((i) => i.kind === "log");
  const steps = group.items.filter((i) => i.kind === "step");

  return (
    <li
      className={`animate-in rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${m.border}`}
    >
      {/* header */}
      <div className="flex items-center gap-2.5">
        <div
          className={`flex size-7 items-center justify-center rounded-lg bg-linear-to-br text-sm ${m.avatar}`}
        >
          {m.emoji}
        </div>
        <span className={`text-sm font-semibold ${m.text}`}>{m.label}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
          {working && !done ? (
            <>
              <span className={`size-1.5 animate-pulse rounded-full ${m.dot}`} />
              working
            </>
          ) : done ? (
            <>done</>
          ) : null}
        </span>
      </div>

      {/* thoughts */}
      {logs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
          {logs.map((item, i) => (
            <li
              key={i}
              className="text-sm leading-snug text-zinc-700 dark:text-zinc-300"
            >
              {(item as Extract<FeedItem, { kind: "log" }>).message}
            </li>
          ))}
        </ul>
      )}

      {/* internal steps (toggle) */}
      {showSteps && steps.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((item, i) => (
            <li
              key={i}
              className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {(item as Extract<FeedItem, { kind: "step" }>).stepName}
            </li>
          ))}
        </ul>
      )}

      {/* sub-agent result (orchestrator's final answer is rendered up top) */}
      {done && group.agent !== "orchestrator" && (
        <p
          className={`mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-zinc-600 dark:text-zinc-300 ${m.soft}`}
        >
          {
            (group.items.find((i) => i.kind === "finish") as
              | Extract<FeedItem, { kind: "finish" }>
              | undefined
            )?.text
          }
        </p>
      )}
    </li>
  );
}

function ConnectionPill({ status, running }: { status: string; running: boolean }) {
  const live = status === "connected";
  const color = live
    ? "bg-emerald-500"
    : status === "error"
      ? "bg-red-500"
      : "bg-amber-500";
  const label = live ? (running ? "live" : "connected") : status;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${color} ${running ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
