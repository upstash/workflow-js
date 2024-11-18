import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult, checkRedisForResults } from "app/ci/upstash/redis"
import { NOTIFIER_CALL_COUNT_OVERRIDE, NOTIFIER_RESULT, NOTIFIER_WORKFLOW_ROUTE, NotifierWorkflowConfig, OBJECT_EVENT_DATA, NOTIFIER_SECRET, TEXT_EVENT_DATA, SDK_EVENT_DATA } from "../constants";

const header = `test-header-foo`
const headerValue = `header-foo`
const payload = "my-payload"

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      // TODO: can't check payload here because
      // payload doesn't exist in handle third party call:
      // expect(input, payload);

      expect(context.headers.get(header)!, headerValue)

      const { eventData, timeout } = await context.waitForEvent(
        "wait for event which should timeout",
        `random-event-${nanoid()}`,
        1
      );
      expect(eventData as undefined, undefined);
      expect(timeout, true);

      // check payload after first step because we can't check above
      expect(input, payload);

      
      const config = await context.run<NotifierWorkflowConfig>("get config", () => {
        return {
          sdkEventId: `sdk-event-${nanoid()}`,
          textEventId: `text-event-${nanoid()}`,
          objectEventId: `object-event-${nanoid()}`,
          redisEntryId: `notifier-workflow-redis-entry-${nanoid()}`,
        }
      })

      // STEP 1: trigger /notifier and wait for it's event
      const sdkResults = await Promise.all([
        context.call(
          "start notifying workflow",
          {
            url: `${TEST_ROUTE_PREFIX}/wait-for-event/notifier`,
            method: "POST",
            body: config,
            headers: { authorization: `Bearer ${NOTIFIER_SECRET}` }
          }
        ),
        context.waitForEvent("wait sdk", config.sdkEventId, 5)
      ])

      expect(sdkResults[0].status, 200)
      expect(sdkResults[0].body as string, "notifying...")
      expect(sdkResults[1].timeout, false)
      expect(typeof sdkResults[1].eventData, "string")
      expect(sdkResults[1].eventData as string, SDK_EVENT_DATA)

      
      // STEP 2: trigger /notifier-workflow and wait for text event
      const textResults = await Promise.all([
        context.call<{ workflowRunId: string }>(
          "start notifying workflow",
          {
            url: `${TEST_ROUTE_PREFIX}/wait-for-event/notifier-workflow`,
            method: "POST",
            body: config,
          }
        ),
        context.waitForEvent("wait text", config.textEventId, 5)
      ])

      expect(textResults[0].status, 200)
      expect(Boolean(textResults[0].body.workflowRunId), true)
      expect(textResults[1].timeout, false)
      expect(typeof textResults[1].eventData, "string")
      expect(textResults[1].eventData as string, TEXT_EVENT_DATA)
      
      // STEP 3: wait for object event from /notifier-workflow
      const {
        eventData: objectEventData,
        timeout: objectTimeout
      } = await context.waitForEvent("wait object", config.objectEventId, 5)

      expect(objectTimeout, false)
      expect(typeof objectEventData, "object")
      expect(JSON.stringify(objectEventData), JSON.stringify(OBJECT_EVENT_DATA))

      await context.sleep("sleep before checking other workflow", 1)
      await context.run("check that other workflow has finished.", async () => {
        await checkRedisForResults(
          NOTIFIER_WORKFLOW_ROUTE,
          config.redisEntryId,
          NOTIFIER_CALL_COUNT_OVERRIDE,
          NOTIFIER_RESULT
        )
      })

      await saveResult(
        context,
        `${TEXT_EVENT_DATA} - ${JSON.stringify(OBJECT_EVENT_DATA)}`
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0
    }
  ), {
    expectedCallCount: 17,
    expectedResult: `${TEXT_EVENT_DATA} - ${JSON.stringify(OBJECT_EVENT_DATA)}`,
    payload,
    headers: {
      [ header ]: headerValue
    }
  }
)
