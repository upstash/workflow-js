export type AgentName =
  | 'Wikipedia'
  | 'WolframAlpha'
  | 'DuckDuckGo'
  | 'Cross Reference';

export type StepRecord = {
  stepName: string;
  stepOut: string;
};

export type StepStatus = "init" | "loading" | "done"