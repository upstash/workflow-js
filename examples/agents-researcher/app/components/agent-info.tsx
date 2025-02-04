import { useState } from "react";
import cx from "../utils/cx";
import CodeBlock from "./code-block";
import { IconCaretDownFilled } from "../icons/caret-dropdown";
import { AgentName } from "../types";

export const AgentInfo = ({
  name,
  code,
  state,
}: {
  name: AgentName;
  code: string;
  state: false | "loading" | string;
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
          <label className="text-sm font-semibold">{name} Agent Code</label>
        </button>
        {displayCode && (
          <CodeBlock className="bg-zinc-800 p-3 rounded-xl language-javascript">
            {code}
          </CodeBlock>
        )}
      </div>
      <div className="flex flex-col gap-2 w-full">
        <button
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
          <label className={"text-sm font-semibold"}>{name} Agent Output</label>
        </button>
        {displayOutput && state && state != "loading" && (
          <div className="border-gray-300 border-2 p-3 rounded-xl text-md font-mono break-words">
            {state}
          </div>
        )}
      </div>
    </div>
  );
};
