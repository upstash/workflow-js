import cx from '../utils/cx';
import type { AgentName } from '../types';

export const AgentBlock = ({
  children,
  name,
  agentInfoDisplay,
  setAgentInfoDisplay,
  isDisabled
}: {
  children: React.ReactNode;
  name: AgentName;
  agentInfoDisplay: AgentName | false;
  setAgentInfoDisplay: (name: AgentName) => void;
  isDisabled: boolean;
}) => {
  return (
    <button
      className={cx(
        'aspect-[3] w-1/3 bg-white border-2 flex items-center justify-center text-opacity-60 rounded-xl',
        agentInfoDisplay === name ? 'border-purple-400' : 'border-gray-300'
      )}
      onClick={() => setAgentInfoDisplay(name)}
      disabled={isDisabled}
    >
      {children}
    </button>
  );
};
