import { useState } from "react";
import cx from "../utils/cx";
import CodeBlock from "./code-block";
import { IconCaretDownFilled } from "../icons/caret-dropdown";
import { AgentName, StepRecord } from "../types";
import Markdown from "markdown-to-jsx";

const CollapsibleText = ({
  title,
  text,
  maxLength = 300,
}: {
  title: string;
  text: string;
  maxLength?: number;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Ensure text starts on a new line by adding a newline if it doesn't already have one
  const formattedText = text && !text.startsWith('\n') ? `\n${text}` : text;

  if (!text || text.length <= maxLength)
    return (
      <div className="border-gray-300 border-2 p-3 rounded-xl text-md font-mono break-words">
        {" "}
        <label className="text-base font-semibold text-purple-500">
          {title}
        </label>
        <Markdown
          className="whitespace-pre-wrap mt-2 *:mb-2 text-sm"
          options={{
            overrides: {
              ol: ({ children }) => (
                <ol className="list-decimal list-inside">{children}</ol>
              ),
              ul: ({ children }) => (
                <ol className="list-disc list-inside">{children}</ol>
              ),
            },
          }}
        >
          {formattedText}
        </Markdown>
      </div>
    );

  const displayText = isExpanded ? formattedText : formattedText.slice(0, maxLength) + "...";

  return (
    <div className="border-gray-300 border-2 p-3 rounded-xl text-md font-mono break-words">
      <label className="text-base font-semibold text-purple-500">{title}</label>
      <Markdown
        className="whitespace-pre-wrap mt-2 *:mb-2 text-sm"
        options={{
          overrides: {
            ol: ({ children }) => (
              <ol className="list-decimal list-inside">{children}</ol>
            ),
            ul: ({ children }) => (
              <ol className="list-disc list-inside">{children}</ol>
            ),
          },
        }}
      >
        {displayText}
      </Markdown>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-purple-500 hover:text-purple-600 font-medium text-sm font-mono mt-2"
      >
        {isExpanded ? "Read Less" : "Read More"}
      </button>
    </div>
  );
};

export const AgentInfo = ({
  name,
  code,
  state,
}: {
  name: AgentName;
  code: string;
  state: false | "loading" | StepRecord[];
}) => {
  const [displayCode, setDisplayCode] = useState(false);
  const [displayOutput, setDisplayOutput] = useState(
    name === "Cross Reference"
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 w-full">
        <button
          className="flex gap-1 w-full bg-purple-500/10 px-2 py-2 rounded-xl items-center text-purple-500"
          onClick={() => setDisplayCode(!displayCode)}
        >
          <IconCaretDownFilled
            className={cx(
              "transform transition-transform",
              displayCode && "rotate-180"
            )}
          />
          <label className="">{name} Agent Code</label>
        </button>
        {displayCode && (
          <CodeBlock className="language-javascript">{code}</CodeBlock>
        )}
      </div>
      <div className="flex flex-col gap-4 w-full">
        <button
          id={
            name === "Cross Reference"
              ? "cross-reference-output"
              : "intermediate-output"
          }
          className={cx(
            "flex gap-1 w-full px-2 py-2 rounded-xl items-center",
            state && state !== "loading"
              ? "bg-purple-500/10 text-purple-500"
              : "bg-gray-100 text-gray-400"
          )}
          onClick={() => {
            if (state && state !== "loading") setDisplayOutput(!displayOutput);
          }}
        >
          <IconCaretDownFilled
            className={cx(
              "transform transition-transform",
              displayOutput && "rotate-180"
            )}
          />
          <label className={""}>{name} Agent Output</label>
        </button>
        {displayOutput &&
          state &&
          state !== "loading" &&
          state.map((s, i) => (
            <div key={i}>
              <CollapsibleText title={s.stepName} text={s.stepOut} />
            </div>
          ))}
      </div>
    </div>
  );
};
