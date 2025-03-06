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
        ' bg-white border-2 size-16 flex items-center justify-center text-opacity-60 rounded-xl',
        agentInfoDisplay === name
          ? 'border-purple-500 bg-purple-100'
          : 'border-gray-200'
      )}
      onClick={() => setAgentInfoDisplay(name)}
      disabled={isDisabled}
    >
      {children}
    </button>
  );
};
