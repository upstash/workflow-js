import { QSTASH_TRIGGER_HEADER, QSTASH_TRIGGER_HEADER_VALUE, THIRD_ENDPOINT_RESULT } from "../constants";

export const POST = async (request: Request) => {
  // Verify the QStash trigger header
  const triggerHeader = request.headers.get(QSTASH_TRIGGER_HEADER);
  if (triggerHeader !== QSTASH_TRIGGER_HEADER_VALUE) {
    return new Response(
      JSON.stringify({ 
        error: `Expected header ${QSTASH_TRIGGER_HEADER} to be ${QSTASH_TRIGGER_HEADER_VALUE}, got ${triggerHeader}` 
      }),
      { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Return a random success response
  return new Response(
    JSON.stringify(THIRD_ENDPOINT_RESULT),
    { 
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Upstash-Workflow-Sdk-Version": "1"
       },
    }
  );
};
