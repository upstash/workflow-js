export type AgentName =
  | "Wikipedia"
  | "WolframAlpha"
  | "Exa"
  | "Cross Reference";

export type StepRecord = {
  stepName: string;
  stepOut: string;
};

export type StepStatus = "init" | "loading" | "done";

export type WorkflowStatus = {
  query: string;
  progress: string;
  agentStates: {
    [key in AgentName]: StepStatus;
  };
};

export type PollResult = {
  query: string | null;
  progress: string | null;
  wikipediaOutput: StepRecord[] | null;
  wolframAlphaOutput: StepRecord[] | null;
  searchOutput: StepRecord[] | null;
  crossReferenceOutput: StepRecord[] | null;
};
