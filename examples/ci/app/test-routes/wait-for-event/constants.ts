export const NOTIFIER_WORKFLOW_ROUTE = "wait-for-event/notifier-workflow"
export const NOTIFIER_RESULT = "super-secret-foo"
export const NOTIFIER_CALL_COUNT_OVERRIDE = -1

export const SDK_EVENT_DATA = "notifying-with-sdk"
export const TEXT_EVENT_DATA = "notifying-with-text-foo"
export const OBJECT_EVENT_DATA = {"notifying": "object", "with": 1}

export const NOTIFIER_SECRET = process.env.UPSTASH_REDIS_REST_TOKEN!.slice(0, 10)

export type NotifierWorkflowConfig = {
  /**
   * event id used in /notifier
   */
  sdkEventId: string,
  /**
   * event id used in /notifier-workflow for text
   */
  textEventId: string,
  /**
   * event id used in /notifier-workflow for object
   */
  objectEventId: string,
  /**
   * random id used to save result to redis in /notifier-workflow
   */
  redisEntryId: string
}
