"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  UIMessage,
} from "ai";
import { useQueryState } from "nuqs";
import { useEffect, useMemo, useRef, useState } from "react";

// just for optics, not needed for durable streams
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  MarkdownA,
  MarkdownBlockquote,
  MarkdownCode,
  MarkdownEm,
  MarkdownH1,
  MarkdownH2,
  MarkdownH3,
  MarkdownH4,
  MarkdownH5,
  MarkdownH6,
  MarkdownHR,
  MarkdownLI,
  MarkdownOL,
  MarkdownP,
  MarkdownPre,
  MarkdownStrong,
  MarkdownUL,
} from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, PlusIcon } from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { Loader } from "./ai-elements/loader";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { Icons } from "./icons";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  ToolInput,
} from "./ai-elements/tool";

export const Chat = ({
  initialHistory,
}: {
  initialHistory: Record<string, UIMessage[]>;
}) => {
  const [input, setInput] = useState("");
  const [messageId, setMessageId] = useQueryState("messageId");
  const [chatId, setChatId] = useQueryState("chatId", { defaultValue: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  const history = initialHistory[chatId] ?? [];

  useEffect(() => {
    if (!chatId) setChatId(crypto.randomUUID());
  }, [chatId]);

  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
    id: chatId ?? undefined,
    resume: Boolean(history.at(-1)?.id === messageId),
    messages: history,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport: new DefaultChatTransport({
      async prepareSendMessagesRequest({ messages, id }) {
        await setChatId(id);
        return { body: { messages, id } };
      },
      prepareReconnectToStreamRequest: (data) => {
        return {
          ...data,
          headers: { ...data.headers, "x-is-reconnect": "true" },
        };
      },
      fetch: async (input, init) => {        
        const headers = new Headers(init?.headers);

        if (headers.get("x-is-reconnect") === "true") {
          return fetch(input + `?id=${messageId}`, {
            ...init,
            method: "GET",
          });
        }

        const { messages } = (JSON.parse(init?.body as string) as { messages: UIMessage[]})
        const lastMessage = messages[messages.length - 1]
        const { id, role } = lastMessage;

        if (role !== "assistant") {
          await setMessageId(id);
        }

        const [res] = await Promise.all([
          fetch(input + `?id=${id}`, { method: "GET" }),
          fetch(input, init),
        ]);

        return res;
      },
    }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleNewChat = () => {
    setMessageId(null);
    setChatId(crypto.randomUUID(), { clearOnDefault: false });
    setInput("");
  };

  const isLoading =
    status === "submitted" ||
    (status === "streaming" &&
      !Boolean(
        messages[messages.length - 1]?.parts.some(
          (part) => part.type === "text" && Boolean(part.text)
        )
      ));

  const visibleMessages = useMemo(
    () =>
      messages.filter((message) =>
        message.parts.some(
          (part) =>
            (part.type === "text" && Boolean(part.text)) ||
            part.type.includes("tool-")
        )
      ),
    [messages]
  );

  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-neutral-900">
      <header className="sticky top-0 flex items-center gap-2 px-2 py-1.5 md:px-2">
        <button
          onClick={handleNewChat}
          className="absolute cursor-pointer rounded-sm flex items-center gap-1.5 px-3 py-2 text-sm left-5 top-5 text-white bg-neutral-800 border border-neutral-600 z-10"
        >
          <PlusIcon weight="bold" />
          New Chat
        </button>
      </header>
      <div
        className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
        style={{ overflowAnchor: "none" }}
      >
        <Conversation className="mx-auto flex min-w-0 max-w-3xl pt-16 flex-col gap-4 md:gap-6 pl-4 pr-2 h-full">
          <ConversationContent className="flex flex-col space-y-10 pb-16 min-h-full">
            {messages.length === 0 ? (
              <div className="max-w-sm mx-auto my-auto h-full flex-1 flex items-center justify-center flex-col gap-6">
                <div className="flex items-center gap-2">
                  <Icons.upstash className="w-28" />
                </div>
                <p className="text-center text-pretty">
                  <span className="opacity-60">
                    Extremely durable AI streams powered by{" "}
                  </span>
                  <a
                    href="https://upstash.com/docs/realtime/overall/getstarted"
                    target="_blank"
                    className="font-medium whitespace-nowrap hover:underline text-[#00e9a3] cursor-pointer"
                  >
                    Upstash Realtime
                  </a>{" "}
                  <span className="opacity-60">and the</span>{" "}
                  <a
                    href="https://ai-sdk.dev/docs/introduction"
                    target="_blank"
                    className="font-medium whitespace-nowrap hover:underline text-[#00e9a3] cursor-pointer"
                  >
                    Vercel AI SDK
                  </a>
                  <span className="opacity-60">
                    . Ask a question, then try refreshing your browser.
                  </span>
                </p>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={cn("rounded-sm", {
                      "bg-neutral-800 text-white border border-neutral-700 px-4 py-2 max-w-2xl":
                        message.role === "user",
                      "text-white font-medium max-w-none":
                        message.role === "assistant",
                    })}
                  >
                    <div
                      className={`${
                        message.role === "user" ? "font-mono" : ""
                      } leading-relaxed space-y-8`}
                    >
                      {message.parts.map((part, i) => {
                        if (part.type === "text") {
                          return (
                            <Streamdown
                              components={{
                                h1: MarkdownH1,
                                h2: MarkdownH2,
                                h3: MarkdownH3,
                                h4: MarkdownH4,
                                h5: MarkdownH5,
                                h6: MarkdownH6,
                                ul: MarkdownUL,
                                ol: MarkdownOL,
                                li: MarkdownLI,
                                p: MarkdownP,
                                code: MarkdownCode,
                                pre: MarkdownPre,
                                blockquote: MarkdownBlockquote,
                                strong: MarkdownStrong,
                                em: MarkdownEm,
                                a: MarkdownA,
                                hr: MarkdownHR,
                              }}
                              isAnimating={status === "streaming"}
                              key={i}
                            >
                              {part.text}
                            </Streamdown>
                          );
                        } else if (part.type === "tool-weather") {
                          return (
                            <Tool
                              key={`${message.id}-${i}`}
                              defaultOpen={part.state === "approval-requested"}
                            >
                              <div className="flex items-center justify-between gap-4">
                                <ToolHeader
                                  type={part.type}
                                  state={part.state}
                                  title={part.type
                                    .split("-")
                                    .slice(1)
                                    .join(" ")}
                                  showExpandIcon={
                                    part.state === "output-available" ||
                                    part.state === "output-error"
                                  }
                                />
                                {part.state === "approval-requested" &&
                                  part.approval?.id && (
                                    <div className="flex gap-2 pr-3">
                                      <button
                                        onClick={() =>
                                          addToolApprovalResponse({
                                            id: part.approval.id,
                                            approved: false,
                                          })
                                        }
                                        className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
                                      >
                                        Reject
                                      </button>
                                      <button
                                        onClick={() =>
                                          addToolApprovalResponse({
                                            id: part.approval.id,
                                            approved: true,
                                          })
                                        }
                                        className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm font-medium"
                                      >
                                        Approve
                                      </button>
                                    </div>
                                  )}
                              </div>

                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput
                                  output={part.output}
                                  errorText={part.errorText}
                                />
                              </ToolContent>
                            </Tool>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}

            {isLoading ? (
              <div className="flex justify-start">
                <div className="bg-neutral-800 rounded-sm text-white border border-neutral-700 px-4 py-2">
                  <div className="flex items-center gap-2 font-mono">
                    <Loader className="size-3.5" />
                    <Shimmer>Thinking</Shimmer>
                  </div>
                </div>
              </div>
            ) : null}
          </ConversationContent>

          <ConversationScrollButton className="!bg-neutral-700 cursor-pointer" />
        </Conversation>
      </div>

      <div className="sticky bottom-0 mx-auto max-w-3xl w-full px-3">
        {messages.length === 0 && (
          <div className="absolute inset-x-3 -top-12 z-50">
            <Suggestions>
              {suggestions.map((suggestion) => (
                <Suggestion
                  className="bg-neutral-700 rounded-sm hover:bg-neutral-600 hover:text-white border-neutral-600 text-white"
                  key={suggestion}
                  onClick={(text) => {
                    sendMessage({ text });
                    setInput("");
                  }}
                  suggestion={suggestion}
                />
              ))}
            </Suggestions>
          </div>
        )}

        <div className="h-30 w-full pb-4">
          <div className="relative rounded-sm bg-neutral-800 outline outline-neutral-700">
            <div className="flex">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSubmit(e);
                  }
                }}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything"
                className="flex-1 px-6 py-4 font-mono text-white placeholder:text-white/60 bg-transparent focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleSubmit}
                className="px-6 py-4 text-white/60 hover:text-white hover:bg-neutral-700 focus:bg-neutral-700 focus:ring-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUpIcon weight="bold" className="size-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* <div
        className={cn("relative z-50 w-full bg-neutral-900", {
          "h-40": messages.length === 0,
          "h-34": messages.length > 0,
        })}
      >
        <div className="max-w-3xl mx-auto mb-8 px-3">
          {messages.length === 0 ? (
            <Suggestions className="h-10 mb-2">
              {suggestions.map((suggestion) => (
                <Suggestion
                  className="bg-neutral-700 hover:bg-neutral-600 hover:text-white border-neutral-600 text-white"
                  key={suggestion}
                  onClick={(text) => {
                    sendMessage({ text })
                    setInput("")
                  }}
                  suggestion={suggestion}
                />
              ))}
            </Suggestions>
          ) : null}

          <div className="relative rounded-sm bg-neutral-800 outline outline-neutral-700">
            <div className="flex">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSubmit(e)
                  }
                }}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything"
                className="flex-1 px-6 py-4 font-mono text-white placeholder:text-white/60 bg-transparent focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleSubmit}
                className="px-6 py-4 text-white/60 hover:text-white hover:bg-neutral-700 focus:bg-neutral-700 focus:ring-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUpIcon weight="bold" className="size-5" />
              </button>
            </div>
          </div>
        </div>
      </div> */}
    </div>
  );
};

const suggestions = [
  "How is the weather in London?",
  "How does machine learning work?",
  "Explain quantum computing",
  "Best practices for React development",
  "Tell me about TypeScript benefits",
  "How to optimize database queries?",
  "What is the difference between SQL and NoSQL?",
  "Explain cloud computing basics",
];
