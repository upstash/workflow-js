import { serve } from '@upstash/workflow/nextjs'
import { saveResultsWithoutContext } from 'app/ci/upstash/redis'
import { NOTIFIER_CALL_COUNT_OVERRIDE, NOTIFIER_RESULT, NOTIFIER_WORKFLOW_ROUTE, NotifierWorkflowConfig, OBJECT_EVENT_DATA, TEXT_EVENT_DATA } from '../constants'

const RETRY_COUNT = 3
const SLEEP_FOR_SEC = 1

export const { POST } = serve<Omit<NotifierWorkflowConfig, "sdkEventId">>(async (context) => {

  let notifiedWithText = false
  for (let i=1; i<=RETRY_COUNT; i+=1) {
    const progress = `${i}/${RETRY_COUNT}`
    // sleep before notifying
    await context.sleep(`sleeping before text ${progress}`, SLEEP_FOR_SEC)

    // notify
    const { notifyResponse } = await context.notify(
      `notify with text ${progress}`,
      context.requestPayload.textEventId,
      TEXT_EVENT_DATA
    )

    // exit loop if succesfully notified
    if (notifyResponse) {
      notifiedWithText = true
      break
    }
  }

  if (!notifiedWithText) {
    throw new Error("Failed to notify with text.")
  }

  let notifiedWithObject = false
  for (let i=1; i<=RETRY_COUNT; i+=1) {
    const progress = `${i}/${RETRY_COUNT}`
    // sleep before notifying
    await context.sleep(`sleeping before object ${progress}`, SLEEP_FOR_SEC)

    // notify
    const { notifyResponse } = await context.notify(
      `notify with object ${progress}`,
      context.requestPayload.objectEventId,
      OBJECT_EVENT_DATA
    )

    // exit loop if succesfully notified
    if (notifyResponse) {
      notifiedWithObject = true
      break
    }
  }

  if (!notifiedWithObject) {
    throw new Error("Failed to notify with object.")
  }
  
  await context.run("save result to redis", async () => {
    await saveResultsWithoutContext(
      NOTIFIER_WORKFLOW_ROUTE,
      context.requestPayload.redisEntryId,
      NOTIFIER_RESULT,
      NOTIFIER_CALL_COUNT_OVERRIDE
    )
  })
}, {
  retries: 0,
})
