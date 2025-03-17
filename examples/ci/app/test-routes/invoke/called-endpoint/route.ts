import { expect } from "app/ci/utils";

export const GET = async (request: Request) => {
  expect(request.headers.get("upstash-workflow-invoke-count"), "2")
  return new Response(JSON.stringify({}), { status: 200 });
}