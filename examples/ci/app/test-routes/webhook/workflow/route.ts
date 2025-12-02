import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { 
  WEBHOOK_TEST_METHOD, 
  WEBHOOK_TEST_BODY, 
  WEBHOOK_TEST_HEADER, 
  WEBHOOK_TEST_HEADER_VALUE 
} from "../constants";
import { saveResult } from "app/ci/upstash/redis";

const header = "test-header-webhook"
const headerValue = "webhook-header-value"
const payload = { test: "webhook-payload" }
const getResult = "webhook test completed successfully"

export const { POST, GET } = testServe(
  serve<typeof payload>(
    async (context) => {
      const input = context.requestPayload;

      expect(context.headers.get(header)!, headerValue)

      const timeoutWebhook = await context.createWebhook(
        "timeout webhook",
      );
      // Wait for a webhook that will timeout
      const timeoutResponse = await context.waitForWebhook(
        "wait for timeout webhook",
        timeoutWebhook,
        "1s"
      );
      expect(timeoutResponse.timeout, true);
      expect(timeoutResponse.request, undefined);

      // Step 1: Create a webhook
      const webhook = await context.createWebhook("create webhook");
      
      // Verify webhook has the expected structure
      expect(typeof webhook.webhookUrl, "string");
      expect(typeof webhook.eventId, "string");
      expect(webhook.webhookUrl.length > 0, true);
      expect(webhook.eventId.length > 0, true);

      // Step 2: Call the caller endpoint with the webhook URL
      const callResult = await context.call(
        "call webhook caller",
        {
          url: `${TEST_ROUTE_PREFIX}/webhook/caller`,
          method: "POST",
          body: {
            webhookUrl: webhook.webhookUrl,
          },
        }
      );

      expect(callResult.status, 200);

      // Step 3: Wait for the webhook to be called
      const webhookResponse = await context.waitForWebhook(
        "wait for webhook",
        webhook,
        "30s"
      );

      // Verify the webhook response contains expected data
      expect(webhookResponse.timeout, false);
      const request = webhookResponse.request!;
      expect(typeof request, "object");
      expect(request.url, webhook.webhookUrl);
      expect(request.method, WEBHOOK_TEST_METHOD);
      expect(typeof request.headers, "object");
      expect(request.headers.get(WEBHOOK_TEST_HEADER), WEBHOOK_TEST_HEADER_VALUE);

      const eventData = await request.json() as typeof WEBHOOK_TEST_BODY
      
      // Check method
      expect(request.method, WEBHOOK_TEST_METHOD);
      
      // Check body
      expect(typeof eventData, "object");
      expect(eventData.test, WEBHOOK_TEST_BODY.test);
      
      // Check headers
      expect(request.headers.get(WEBHOOK_TEST_HEADER), WEBHOOK_TEST_HEADER_VALUE);

      // Step 4: Final verification step
      const result = await context.run("verify complete", () => {
        expect(input.test, payload.test);
        return getResult;
      });

      await saveResult(
        context,
        result
      )
    },
    {
      receiver: undefined,
    }
  ),
  {
    expectedCallCount: 7,
    expectedResult: getResult,
    headers: {
      [header]: headerValue,
    },
    payload
  }
);
