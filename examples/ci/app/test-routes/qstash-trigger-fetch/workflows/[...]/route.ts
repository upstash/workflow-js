
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult, fail } from "app/ci/upstash/redis";
import { 
  QSTASH_TRIGGER_HEADER, 
  QSTASH_TRIGGER_HEADER_VALUE, 
  WORKFLOW_WEBHOOK_RESULT,
} from "../../constants";
import { Client, WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";

const header = "test-header-qstash-trigger"
const headerValue = "qstash-trigger-header-value"
const payload = { test: "qstash-trigger-payload" }
const getResult = "qstash-trigger test completed successfully"

type TriggerResponse = {
  workflowRunId: string,
  workflowCreatedAt: number
}

const QSTASH_URL = process.env.QSTASH_URL ?? "https://qstash.upstash.io";

const workflowClient = new Client({
  baseUrl: QSTASH_URL,
  token: process.env.QSTASH_TOKEN!,
})

const mainWorkflow = createWorkflow(async (context: WorkflowContext<typeof payload>) => {
  const input = context.requestPayload;

  expect(context.headers.get(header)!, headerValue)
  expect(input.test, payload.test);

  // Create webhook for the 2nd endpoint to call back
  const webhook = await context.createWebhook("create webhook");
  
  // Verify webhook has the expected structure
  expect(typeof webhook.webhookUrl, "string");
  expect(typeof webhook.eventId, "string");

  // Step 1: Call the 2nd endpoint (workflow) using QStash trigger pattern
  const callWorkflowResponse = await context.run("call workflow endpoint", async () => {
    const response = await fetch(
      `${QSTASH_URL}/v2/trigger/${TEST_ROUTE_PREFIX}/qstash-trigger-fetch/workflows/webhookWorkflow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.QSTASH_TOKEN}`,
          [`upstash-forward-${QSTASH_TRIGGER_HEADER}`]: QSTASH_TRIGGER_HEADER_VALUE,
          [`upstash-forward-${CI_RANDOM_ID_HEADER}`]: context.headers.get(CI_RANDOM_ID_HEADER)!,
          [`upstash-forward-${CI_ROUTE_HEADER}`]: context.headers.get(CI_ROUTE_HEADER)!,
          "Upstash-Retries": "0"
        },
        body: JSON.stringify({ webhookUrl: webhook.webhookUrl }),
      }
    );

    if (!response.ok) {
      throw new WorkflowNonRetryableError(`Workflow call failed with status ${response.status}. Error: ${await response.text()}`);
    }
    
    return response.ok;
  });

  expect(callWorkflowResponse, true);

  // Step 2: Call the 3rd endpoint (POST endpoint) using QStash trigger pattern
  const callPostEndpointResponse = await context.run("call post endpoint", async () => {
    const response = await fetch(
      `${QSTASH_URL}/v2/trigger/${TEST_ROUTE_PREFIX}/qstash-trigger-fetch/post`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.QSTASH_TOKEN}`,
          [`upstash-forward-${QSTASH_TRIGGER_HEADER}`]: QSTASH_TRIGGER_HEADER_VALUE,
          "Upstash-Retries": "0"
        },
        body: JSON.stringify({ data: "test-data" }),
      }
    );

    if (!response.ok) {
      throw new WorkflowNonRetryableError(`POST endpoint call failed with status ${response.status}. Error: ${await response.text()}`);
    }
    
    const result = await response.json() as TriggerResponse;
    return result;
  });
  
  expect(typeof callPostEndpointResponse.workflowRunId, "string");
  expect(typeof callPostEndpointResponse.workflowCreatedAt, "number");

  // Step 3: Wait for the webhook to be called by the 2nd endpoint
  const webhookResponse = await context.waitForWebhook(
    "wait for webhook",
    webhook,
    "30s"
  );

  // Verify the webhook was called
  expect(webhookResponse.timeout, false);
  const request = webhookResponse.request!;
  expect(typeof request, "object");
  expect(request.method, "POST");

  const webhookData = await request.json() as { result: string }
  expect(webhookData.result, WORKFLOW_WEBHOOK_RESULT);

  // Step 4: Final verification step
  const result = await context.run("verify complete", async () => {

    for (let i = 0; i < 5; i++) {
      
      const logs = await workflowClient.logs({
        workflowRunId: callPostEndpointResponse.workflowRunId
      })

      if (logs.runs.length === 0) {
        console.log("waiting for logs to be available...", i);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      const run = logs.runs[0];
      expect(run.workflowRunId, callPostEndpointResponse.workflowRunId);
      expect(run.workflowState, "RUN_FAILED")
      expect(run.steps.length, 2)
      expect(run.steps[0].steps.length, 1)
      expect(run.steps[0].steps[0].state, "STEP_SUCCESS")
      expect(run.steps[1].steps.length, 1)

      const nextStep = run.steps[1]
      if (nextStep.type === "next") {
        expect(nextStep.steps[0].errors![0].error, "trigger rest api is only usable with sdk versions after v1.0.0 major version")
        return getResult
      } else {
        throw new WorkflowNonRetryableError("Unexpected step type when checking workflow logs in the test")
      }      
    }
    throw new WorkflowNonRetryableError("failed the test because incorrect logs were returned after retries")
  });

  await saveResult(
    context,
    result
  )
})

const webhookWorkflow = createWorkflow(async (context: WorkflowContext<{ webhookUrl: string }>) => {
  const { webhookUrl } = context.requestPayload;

  // Verify that we received the webhook URL
  if (!webhookUrl) {
    throw new Error("webhook URL not provided");
  }

  // Verify the QStash trigger header
  const triggerHeader = context.headers.get(QSTASH_TRIGGER_HEADER);
  if (triggerHeader !== QSTASH_TRIGGER_HEADER_VALUE) {
    throw new Error(`Expected header ${QSTASH_TRIGGER_HEADER} to be ${QSTASH_TRIGGER_HEADER_VALUE}, got ${triggerHeader}`);
  }

  // Step 1: Do some work
  await context.run("do work", () => {
    return "work completed";
  });

  // Step 2: Call the webhook before finishing
  const webhookCallResult = await context.run("call webhook", async () => {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ result: WORKFLOW_WEBHOOK_RESULT }),
    });

    if (!response.ok) {
      throw new Error(`webhook call failed with status ${response.status}`);
    }

    return response.ok;
  });

  return { success: true, webhookCalled: webhookCallResult };
})

export const { POST, GET } = testServe(
  serveMany(
    {
      mainWorkflow,
      webhookWorkflow,
    },
    {
      baseUrl: BASE_URL,
      receiver: undefined,
      failureFunction: async ({ context }) => {
        console.log("failing");
        await fail(context as WorkflowContext)
      }
    }
  ), {
    expectedCallCount: 9,
    expectedResult: getResult,
    payload,
    headers: {
      [ header ]: headerValue,
    },
    triggerConfig: {
      retries: 0
    }
  }
)
