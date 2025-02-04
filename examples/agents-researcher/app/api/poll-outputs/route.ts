import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  const { workflowRunId } = await req.json();

  const wikipediaOutput = await redis.get<string>(
    `${workflowRunId}:wikipediaOutput`
  );
  const wolframAlphaOutput = await redis.get<string>(
    `${workflowRunId}:wolframAlphaOutput`
  );
  const searchOutput = await redis.get<string>(`${workflowRunId}:searchOutput`);
  const crossReferenceOutput = await redis.get<string>(
    `${workflowRunId}:crossReferenceOutput`
  );

  const result = {
    wikipediaOutput,
    wolframAlphaOutput,
    searchOutput:
      typeof searchOutput === "string"
        ? searchOutput
        : searchOutput === null
        ? null
        : JSON.stringify(searchOutput),
    crossReferenceOutput,
  };

  return Response.json(result);
}
