import { StepRecord } from '@/app/types';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  const { workflowRunId } = await req.json();

  const progress = await redis.get(`${workflowRunId}:progress`);
  const wikipediaOutput = await redis.lrange(
    `${workflowRunId}:wikipediaOutput`,
    0,
    -1
  );
  const wolframAlphaOutput = await redis.lrange(
    `${workflowRunId}:wolframAlphaOutput`,
    0,
    -1
  );
  const searchOutput = (
    await redis.lrange(`${workflowRunId}:searchOutput`, 0, -1)
  ).map((j) => {
    const { stepName, stepOut } = j as unknown as StepRecord;
    return {
      stepName,
      stepOut:
        typeof stepOut === 'string'
          ? stepOut
          : stepOut === null
            ? null
            : JSON.stringify(stepOut)
    };
  });
  const crossReferenceOutput = await redis.lrange(
    `${workflowRunId}:crossReferenceOutput`,
    0,
    -1
  );
  console.log(progress);

  const result = {
    progress: progress === 'Save Cross Reference Output' ? null : progress,
    wikipediaOutput: wikipediaOutput.length === 0 ? null : wikipediaOutput,
    wolframAlphaOutput:
      wolframAlphaOutput.length === 0 ? null : wolframAlphaOutput,
    searchOutput: searchOutput.length === 0 ? null : searchOutput,
    crossReferenceOutput:
      crossReferenceOutput.length === 0 ? null : crossReferenceOutput
  };

  return Response.json(result);
}
