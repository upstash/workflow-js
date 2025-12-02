import { 
  WEBHOOK_TEST_METHOD, 
  WEBHOOK_TEST_BODY, 
  WEBHOOK_TEST_HEADER, 
  WEBHOOK_TEST_HEADER_VALUE 
} from "../constants";

export const POST = async (request: Request) => {
  const { webhookUrl } = await request.json() as { webhookUrl: string };

  if (!webhookUrl) {
    return new Response("webhook URL not provided", { status: 400 });
  }

  // Call the webhook URL with specific method, body, and headers
  const response = await fetch(webhookUrl, {
    method: WEBHOOK_TEST_METHOD,
    headers: {
      "Content-Type": "application/json",
      [WEBHOOK_TEST_HEADER]: WEBHOOK_TEST_HEADER_VALUE,
    },
    body: JSON.stringify(WEBHOOK_TEST_BODY),
  });

  if (!response.ok) {
    return new Response(`webhook call failed with status ${response.status}`, { 
      status: 500 
    });
  }

  return new Response("webhook called", { status: 200 });
};
