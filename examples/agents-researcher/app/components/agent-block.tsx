import cx from '../utils/cx';
import type { AgentName } from '../types';

export const AgentBlock = ({
  children,
  name,
  agentInfoDisplay,
  setAgentInfoDisplay
}: {
  children: React.ReactNode;
  name: AgentName;
  agentInfoDisplay: AgentName;
  setAgentInfoDisplay: (name: AgentName) => void;
}) => {
  return (
    <button
      className={cx(
        'aspect-square w-1/3 bg-white border-2 flex items-center justify-center text-opacity-60 rounded-xl',
        agentInfoDisplay === name ? 'border-purple-400' : 'border-gray-300'
      )}
      onClick={() => setAgentInfoDisplay(name)}
    >
      {children}
    </button>
  );
};
