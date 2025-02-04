import cx from "../utils/cx";
import type { AgentName } from "../types";

export const AgentBlock = ({
  children,
  name,
  state,
  setAgentInfoDisplay,
}: {
  children: React.ReactNode;
  name: AgentName;
  state: false | "loading" | string;
  setAgentInfoDisplay: (name: AgentName) => void;
}) => {
  return (
    <button
      className={cx(
        "aspect-square w-1/3 bg-white border-2 flex items-center justify-center text-opacity-60 rounded-xl",
        state && (state !== "loading" ? "border-emerald-400" : "animate-pulse")
      )}
      onClick={() => setAgentInfoDisplay(name)}
    >
      {children}
    </button>
  );
};
