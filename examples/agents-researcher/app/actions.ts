"use server";

import { PollResult, StepRecord } from "./types";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function pollOutputs(workflowRunId: string): Promise<PollResult> {
  const progress = await redis.get<string | null>(`${workflowRunId}:progress`);
  const query = await redis.get<string | null>(`${workflowRunId}:query`);
  const wikipediaOutput = await redis.lrange<StepRecord>(
    `${workflowRunId}:wikipediaOutput`,
    0,
    -1
  );
  const wolframAlphaOutput = await redis.lrange<StepRecord>(
    `${workflowRunId}:wolframAlphaOutput`,
    0,
    -1
  );
  const searchOutput = (
    await redis.lrange<StepRecord>(`${workflowRunId}:searchOutput`, 0, -1)
  ).map((j) => {
    const { stepName, stepOut } = j;
    return {
      stepName,
      stepOut:
        typeof stepOut === "string"
          ? stepOut
          : stepOut === null
          ? ""
          : JSON.stringify(stepOut),
    };
  });
  const crossReferenceOutput = await redis.lrange<StepRecord>(
    `${workflowRunId}:crossReferenceOutput`,
    0,
    -1
  );

  const result: PollResult = {
    query,
    progress: progress === "Save Cross Reference Output" ? null : progress,
    wikipediaOutput: wikipediaOutput.length === 0 ? null : wikipediaOutput,
    wolframAlphaOutput:
      wolframAlphaOutput.length === 0 ? null : wolframAlphaOutput,
    searchOutput: searchOutput.length === 0 ? null : searchOutput,
    crossReferenceOutput:
      crossReferenceOutput.length === 0 ? null : crossReferenceOutput,
  };

  return result;
}
