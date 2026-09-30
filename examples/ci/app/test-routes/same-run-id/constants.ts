/**
 * The runner starts the target workflow twice, one run after the other, with the
 * same workflow run id and the same data. QStash deduplicates workflow requests by
 * their content, so the requests of the second run must differ from the requests of
 * the first one by the creation time of the run (Upstash-Workflow-CreatedAt).
 * Otherwise the second trigger, or a step of the second run, is deduplicated
 * against the first run and the second run never finishes.
 */

// hardcoded on purpose: every run of the target (and of its invoked child) has the same id
export const TARGET_RUN_ID = "same-run-id-target"
export const CHILD_RUN_ID = "same-run-id-child"

export const TARGET_PAYLOAD = { input: "same-run-id-input" }
export const CHILD_PAYLOAD = "same-run-id-child-input"
export const CHILD_RESULT = `child received ${CHILD_PAYLOAD}`

export const EVENT_ID = "same-run-id-event"
export const TIMEOUT_EVENT_ID = "same-run-id-timeout-event"
export const NOBODY_WAITS_EVENT_ID = "same-run-id-nobody-waits-event"
export const EVENT_DATA = { event: "same-run-id-event-data" }
export const WEBHOOK_BODY = { webhook: "same-run-id-webhook-body" }

export const CALL_HEADER_VALUE = "same-run-id-call"

/**
 * the steps of a successful run of the target, as they appear in the logs
 */
export const TARGET_STEP_NAMES = [
  "init",
  "parallel run one",
  "parallel run two",
  "sleep",
  "sleep until",
  "call",
  "wait for event",
  "notify the waiting step",
  "wait for event to time out",
  "notify",
  "create webhook",
  "call webhook",
  "wait for webhook",
  "invoke",
  "last",
]

export const TARGET_LAST_STEP_RESULT = [
  "one",
  "two",
  200,
  EVENT_DATA.event,
  WEBHOOK_BODY.webhook,
  CHILD_RESULT,
].join(":")

export const RUNNER_RESULT = "both runs with the same id finished"
