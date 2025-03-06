"use server";

import { PollResult, StepRecord } from "./types";
import { Redis } from "@upstash/redis";

export async function pollOutputs(workflowRunId: string): Promise<PollResult> {
  const redis = Redis.fromEnv();

  const progress = (await redis.get(`${workflowRunId}:progress`)) as
    | string
    | null;
  const query = (await redis.get(`${workflowRunId}:query`)) as string | null;
  const wikipediaOutput = (await redis.lrange(
    `${workflowRunId}:wikipediaOutput`,
    0,
    -1
  )) as StepRecord[];
  const wolframAlphaOutput = (await redis.lrange(
    `${workflowRunId}:wolframAlphaOutput`,
    0,
    -1
  )) as StepRecord[];
  const searchOutput = (
    await redis.lrange(`${workflowRunId}:searchOutput`, 0, -1)
  ).map((j) => {
    const { stepName, stepOut } = j as unknown as StepRecord;
    return {
      stepName,
      stepOut:
        typeof stepOut === "string"
          ? stepOut
          : stepOut === null
          ? null
          : JSON.stringify(stepOut),
    };
  }) as StepRecord[];
  const crossReferenceOutput = (await redis.lrange(
    `${workflowRunId}:crossReferenceOutput`,
    0,
    -1
  )) as StepRecord[];

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
