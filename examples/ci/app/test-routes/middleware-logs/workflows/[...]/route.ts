import { WorkflowContext } from "@upstash/workflow";
import { createWorkflow, serveMany } from "@upstash/workflow/nextjs";
import { WorkflowMiddleware, WorkflowNonRetryableError } from "@upstash/workflow";
import { BASE_URL, CI_RANDOM_ID_HEADER, CI_ROUTE_HEADER, TEST_ROUTE_PREFIX } from "app/ci/constants";
import { redis, saveResult } from "app/ci/upstash/redis";
import { ANY_STRING, expect, testServe } from "app/ci/utils";

const testHeader = `test-header-middleware`
const headerValue = `header-middleware-value`
const payload = "middleware-test-payload"

const REDIS_LOG_PREFIX = "wf-middleware-logs"

/**
 * Helper to get Redis key for workflow logs
 */
const getLogKey = (workflowRunId: string) => {
  return `${REDIS_LOG_PREFIX}-${workflowRunId}`
}

/**
 * Helper to check expected logs in Redis for a given workflow run
 */
const checkLogs = async (workflowRunId: string, expectedLogs: string[]) => {
  const key = getLogKey(workflowRunId)
  const logs = await redis.lrange<string>(key, 0, -1)

  if (!logs || logs.length === 0) {
    throw new Error(`No logs found for workflowRunId: ${workflowRunId}`)
  }

  expect(logs.length, expectedLogs.length)

  for (let i = 0; i < expectedLogs.length; i++) {
    expect(logs[i], expectedLogs[i])
  }
}

/**
 * Middleware that logs to Redis
 */
const redisLoggingMiddleware = new WorkflowMiddleware<unknown, unknown>({
  name: "redisLogging",
  callbacks: {
    async runStarted({ context }) {
      if (context.workflowRunId) {
        const key = getLogKey(context.workflowRunId)
        await redis.rpush(key, "runStarted")
        await redis.expire(key, 60)
      }
    },
    async runCompleted({ context, result }) {
      if (context.workflowRunId) {
        const key = getLogKey(context.workflowRunId)
        await redis.rpush(key, `runCompleted:${JSON.stringify(result)}`)
        await redis.expire(key, 60)
      }
    },
    async beforeExecution({ context, stepName }) {
      if (context.workflowRunId) {
        const key = getLogKey(context.workflowRunId)
        await redis.rpush(key, `beforeExecution:${stepName}`)
        await redis.expire(key, 60)
      }
    },
    async afterExecution({ context, stepName }) {
      if (context.workflowRunId) {
        const key = getLogKey(context.workflowRunId)
        await redis.rpush(key, `afterExecution:${stepName}`)
        await redis.expire(key, 60)
      }
    },
    async onError({ workflowRunId, error }) {
      if (workflowRunId) {
        const key = getLogKey(workflowRunId)
        await redis.rpush(key, `onError:${error.message}`)
        await redis.expire(key, 60)
      }
    },
    async onWarning({ workflowRunId, warning }) {
      if (workflowRunId) {
        const key = getLogKey(workflowRunId)
        await redis.rpush(key, `onWarning:${warning}`)
        await redis.expire(key, 60)
      }
    },
    async onInfo({ workflowRunId, info }) {
      if (workflowRunId) {
        const key = getLogKey(workflowRunId)
        await redis.rpush(key, `onInfo:${info}`)
        await redis.expire(key, 60)
      }
    },
  },
})

/**
 * Workflow 1: Run and Sleep
 * Tests context.run and context.sleep steps
 */
const runAndSleepWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  const result1 = await context.run("run step", async () => {
    return "run-result"
  })

  expect(result1, "run-result")

  await context.sleep("sleep step", 1)

  return {
    result: "runAndSleep-complete",
    workflowRunId: context.workflowRunId
  }
})

/**
 * Workflow 2: Call
 * Tests context.call to a third-party endpoint
 */
const calledEndpoint = `${TEST_ROUTE_PREFIX}/middleware-logs/called-endpoint`

const callWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  const { status, body } = await context.call<{ message: string }>("call step", {
    url: calledEndpoint,
    method: "GET",
  })

  expect(status, 200)
  expect(body.message, "middleware-logs-endpoint-result")

  return {
    result: "call-complete",
    workflowRunId: context.workflowRunId
  }
})

/**
 * Workflow 3: Wait For Event Timeout
 * Tests context.waitForEvent with timeout
 */
const waitForEventTimeoutWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  const { eventData, timeout } = await context.waitForEvent(
    "wait for event",
    `random-event-never-triggered-${Date.now()}`,
    {
      timeout: 1
    }
  )

  expect(timeout, true)
  expect(eventData as undefined, undefined)

  return {
    result: "waitForEventTimeout-complete",
    workflowRunId: context.workflowRunId
  }
})

/**
 * Main workflow that invokes other workflows and checks logs
 */
const mainWorkflow = createWorkflow(async (context: WorkflowContext<string>) => {
  expect(context.requestPayload, payload)
  expect(context.headers.get(testHeader), headerValue)

  // Invoke runAndSleepWorkflow
  const result1 = await context.invoke("invoke runAndSleep", {
    workflow: runAndSleepWorkflow,
    body: "test",
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
  })

  expect(result1.body.result, "runAndSleep-complete")
  expect(result1.isFailed, false)

  // Check logs for runAndSleepWorkflow
  await context.run("check logs 1", async () => {
    const workflowRunId = result1.body.workflowRunId
    if (workflowRunId) {
      await checkLogs(workflowRunId, [
        'onInfo:Run id identified.',
        'runStarted',
        'beforeExecution:run step',
        `onInfo:Submitted step "run step" with messageId: ${ANY_STRING}.`,
        'onInfo:Workflow endpoint execution completed successfully.',
        'onInfo:Run id identified.',
        'afterExecution:run step',
        'beforeExecution:sleep step',
        `onInfo:Submitted step "sleep step" with messageId: ${ANY_STRING}.`,
        'onInfo:Workflow endpoint execution completed successfully.',
        'onInfo:Run id identified.',
        'afterExecution:sleep step',
        `runCompleted:{"result":"runAndSleep-complete","workflowRunId":"${workflowRunId}"}`,
        `onInfo:Deleting workflow run ${workflowRunId} from QStash.`,
        `onInfo:Workflow run ${workflowRunId} deleted from QStash successfully.`,
        'onInfo:Workflow endpoint execution completed successfully.'
      ])
    } else {
      throw new WorkflowNonRetryableError("workflowRunId not found in result1.body")
    }
  })

  // Invoke callWorkflow
  const result2 = await context.invoke("invoke call", {
    workflow: callWorkflow,
    body: "test",
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
  })

  expect(result2.body.result, "call-complete")
  expect(result2.isFailed, false)

  // Check logs for callWorkflow
  await context.run("check logs 2", async () => {
    const workflowRunId = result2.body.workflowRunId
    if (workflowRunId) {
      await checkLogs(workflowRunId, [
        'onInfo:Run id identified.',
        'runStarted',
        'beforeExecution:call step',
        `onInfo:Submitted step "call step" with messageId: ${ANY_STRING}.`,
        'onInfo:Workflow endpoint execution completed successfully.',
        'onInfo:Run id identified.',
        'afterExecution:call step',
        `runCompleted:{"result":"call-complete","workflowRunId":"${workflowRunId}"}`,
        `onInfo:Deleting workflow run ${workflowRunId} from QStash.`,
        `onInfo:Workflow run ${workflowRunId} deleted from QStash successfully.`,
        'onInfo:Workflow endpoint execution completed successfully.'
      ])
    } else {
      throw new WorkflowNonRetryableError("workflowRunId not found in result2.body")
    }
  })

  // Invoke waitForEventTimeoutWorkflow
  const result3 = await context.invoke("invoke waitForEvent", {
    workflow: waitForEventTimeoutWorkflow,
    body: "test",
    headers: {
      [CI_ROUTE_HEADER]: context.headers.get(CI_ROUTE_HEADER) as string,
      [CI_RANDOM_ID_HEADER]: context.headers.get(CI_RANDOM_ID_HEADER) as string,
    },
  })

  expect(result3.body.result, "waitForEventTimeout-complete")
  expect(result3.isFailed, false)

  // Check logs for waitForEventTimeoutWorkflow
  await context.run("check logs 3", async () => {
    const workflowRunId = result3.body.workflowRunId
    if (workflowRunId) {
      await checkLogs(workflowRunId, [
        'onInfo:Run id identified.',
        'runStarted',
        'beforeExecution:wait for event',
        'onInfo:Workflow endpoint execution completed successfully.',
        'onInfo:Run id identified.',
        'afterExecution:wait for event',
        `runCompleted:{"result":"waitForEventTimeout-complete","workflowRunId":"${workflowRunId}"}`,
        `onInfo:Deleting workflow run ${workflowRunId} from QStash.`,
        `onInfo:Workflow run ${workflowRunId} deleted from QStash successfully.`,
        'onInfo:Workflow endpoint execution completed successfully.'
      ])
    } else {
      throw new WorkflowNonRetryableError("workflowRunId not found in result3.body")
    }
  })

  await saveResult(context, "all-middleware-tests-complete")
})

export const { POST, GET } = testServe(
  serveMany({
    mainWorkflow,
    runAndSleepWorkflow,
    callWorkflow,
    waitForEventTimeoutWorkflow,
  }, {
    baseUrl: BASE_URL,
    middlewares: [redisLoggingMiddleware],
  }),
  {
    expectedCallCount: 15,
    expectedResult: "all-middleware-tests-complete",
    payload,
    headers: {
      [testHeader]: headerValue,
    },
    triggerConfig: {
      retries: 0,
    }
  }
)
