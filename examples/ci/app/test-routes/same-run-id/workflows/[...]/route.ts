import { Client, WorkflowContext, WorkflowNonRetryableError } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { expect } from "app/ci/utils";
import {
  CALL_HEADER_VALUE,
  CHILD_PAYLOAD,
  CHILD_RESULT,
  EVENT_DATA,
  getTargetIds,
  TARGET_LAST_STEP_RESULT,
  TARGET_PAYLOAD,
  WEBHOOK_BODY,
} from "../../constants";

/**
 * The target of the same-run-id test. It is started by the runner, not by the test
 * itself, so it isn't wrapped in testServe: the runner checks its runs in the logs.
 *
 * It uses every kind of step the context has, so that each kind of request is sent
 * again, with the same data, by the second run with the same id. context.api is
 * left out since it calls third party services, and context.cancel since it would
 * end the run.
 */

const workflowClient = new Client({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

const child = createWorkflow(async (context: WorkflowContext<string>) => {
  const result = await context.run("child step", () => `child received ${context.requestPayload}`)
  await context.sleep("child sleep", 1)
  return result
})

const target = createWorkflow(async (context: WorkflowContext<typeof TARGET_PAYLOAD>) => {
  const { childRunId, eventId, timeoutEventId, nobodyWaitsEventId } = getTargetIds(context.workflowRunId)

  const [one, two] = await Promise.all([
    context.run("parallel run one", () => "one"),
    context.run("parallel run two", () => "two"),
  ])

  // checked after the first step: the request delivering a context.call result runs the
  // route function until the first step to authorize it, and that request has no payload
  expect(context.requestPayload.input, TARGET_PAYLOAD.input)

  await context.sleep("sleep", 1)
  await context.sleepUntil("sleep until", Date.now() / 1000 + 1)

  const callResponse = await context.call("call", {
    url: `${TEST_ROUTE_PREFIX}/call/third-party`,
    method: "GET",
    headers: { "get-header": CALL_HEADER_VALUE },
  })
  expect(callResponse.status, 200)
  expect(callResponse.body as string, `called GET 'third-party-result' '${CALL_HEADER_VALUE}'`)

  // the run step notifies the wait once QStash has registered it
  const [waitResponse] = await Promise.all([
    context.waitForEvent("wait for event", eventId, { timeout: "30s" }),
    context.run("notify the waiting step", async () => {
      for (let i = 0; i < 20; i++) {
        const notified = await workflowClient.notify({ eventId, eventData: EVENT_DATA })
        if (notified.length > 0) {
          return notified.length
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      throw new WorkflowNonRetryableError(`nobody was waiting for ${eventId}`)
    }),
  ])
  expect(waitResponse.timeout, false)
  expect((waitResponse.eventData as typeof EVENT_DATA).event, EVENT_DATA.event)

  const { timeout } = await context.waitForEvent("wait for event to time out", timeoutEventId, { timeout: 1 })
  expect(timeout, true)

  const { notifyResponse } = await context.notify("notify", nobodyWaitsEventId, EVENT_DATA)
  expect(notifyResponse.length, 0)

  const webhook = await context.createWebhook("create webhook")
  await context.run("call webhook", async () => {
    const response = await fetch(webhook.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(WEBHOOK_BODY),
    })
    if (!response.ok) {
      throw new WorkflowNonRetryableError(`webhook call failed with status ${response.status}`)
    }
    return response.status
  })
  const webhookResponse = await context.waitForWebhook("wait for webhook", webhook, "30s")
  expect(webhookResponse.timeout, false)
  const webhookBody = await webhookResponse.request!.json() as typeof WEBHOOK_BODY

  const invokeResponse = await context.invoke("invoke", {
    workflow: child,
    body: CHILD_PAYLOAD,
    workflowRunId: childRunId,
    retries: 0,
  })
  expect(invokeResponse.isFailed, false)
  expect(invokeResponse.body, CHILD_RESULT)

  const last = await context.run("last", () => [
    one,
    two,
    callResponse.status,
    (waitResponse.eventData as typeof EVENT_DATA).event,
    webhookBody.webhook,
    invokeResponse.body,
  ].join(":"))
  expect(last, TARGET_LAST_STEP_RESULT)
})

export const { POST } = serveMany(
  { target, child },
  { baseUrl: BASE_URL }
)
