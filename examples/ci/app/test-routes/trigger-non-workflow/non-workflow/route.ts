import { NON_WORKFLOW_ROUTE_RESPONSE } from "../constants";

export const POST = async (request: Request) => {
  return new Response(NON_WORKFLOW_ROUTE_RESPONSE, { status: 200 });
}