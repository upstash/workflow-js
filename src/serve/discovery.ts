import { WorkflowContext } from "../context";
import { isInstanceOf, WorkflowDiscoveryAbort } from "../error";
import { getHeaders, getStepSettingsHeaders } from "../qstash/headers";
import { RouteFunction, Step, StepSettings, Telemetry, WorkflowClient } from "../types";
import { WORKFLOW_DISCOVERY_CALL_TYPE } from "../constants";

/**
 * Parameters provided by the caller of a next step discovery.
 */
export type NextStepDiscoveryParams = {
  /**
   * memoized steps of the run to replay, including the newly arrived
   * result step if there is one
   */
  steps: Step[];
  /**
   * raw initial payload of the run
   */
  rawInitialPayload: string;
  /**
   * invoke count of the run
   */
  invokeCount: number;
};

/**
 * A function which discovers the step-level settings of the next step
 * of the workflow, given the steps of the run.
 *
 * Returns undefined if there is no next step, if the next step has no
 * settings or if the discovery fails.
 */
export type NextStepDiscovery = (
  params: NextStepDiscoveryParams
) => Promise<StepSettings | undefined>;

/**
 * Creates a function which discovers the next step of the workflow by
 * replaying the route function with the given steps.
 *
 * The replay runs the route function with a context in discovery mode:
 * memoized steps replay as usual (so that branching on step results
 * works) and when the replay reaches a step which hasn't executed yet,
 * the executor throws `WorkflowDiscoveryAbort` carrying the step's
 * step-level settings, without executing the step or making any
 * requests.
 *
 * Discovery never throws: if the replay fails for any reason, undefined
 * is returned and the caller falls back to the settings the run was
 * triggered with.
 *
 * @param routeFunction route function of the workflow
 * @param workflowContext context of the current request; provides
 *   everything except the steps, which are passed at discovery time
 * @param initialPayloadParser parser for the initial payload
 */
export const makeNextStepDiscovery = <TInitialPayload, TResult>({
  routeFunction,
  workflowContext,
  initialPayloadParser,
}: {
  routeFunction: RouteFunction<TInitialPayload, TResult>;
  workflowContext: WorkflowContext<TInitialPayload>;
  initialPayloadParser: (initialPayload: string) => TInitialPayload;
}): NextStepDiscovery => {
  return async ({ steps, rawInitialPayload, invokeCount }) => {
    try {
      const discoveryContext = new WorkflowContext<TInitialPayload>({
        qstashClient: workflowContext.qstashClient,
        workflowRunId: workflowContext.workflowRunId,
        workflowRunCreatedAt: workflowContext.workflowRunCreatedAt,
        headers: workflowContext.headers,
        steps,
        url: workflowContext.url,
        initialPayload: initialPayloadParser(rawInitialPayload),
        env: workflowContext.env,
        invokeCount,
        label: workflowContext.labels,
        retried: workflowContext.retried,
        discoveryMode: true,
      });

      await routeFunction(discoveryContext);

      // the route function ended without reaching a new step
      return undefined;
    } catch (error) {
      if (isInstanceOf(error, WorkflowDiscoveryAbort)) {
        return error.stepSettings;
      }
      // discovery failed (an error was thrown before reaching the next
      // step, or the workflow was cancelled/aborted in another way).
      // Fall back to the settings the run was triggered with.
      return undefined;
    }
  };
};

/**
 * Publishes a hidden helper request which makes QStash call the workflow
 * endpoint again with the given step-level settings applied.
 *
 * Used when the settings of the next step are discovered in a request
 * which was already delivered without them (the delivery which carries
 * the result of a `context.invoke` step). Instead of executing the next
 * step in the current (ungated) delivery, the redelivery is published
 * with the settings: its delivery is gated by the step-level flow
 * control and executes the step.
 *
 * The request has the `discovery` call type: QStash doesn't treat it as
 * a step and hides it from the step logs. The body is only used to
 * differentiate redeliveries of different steps of the same run, since
 * QStash deduplicates workflow requests based on content.
 *
 * @param client QStash client
 * @param workflowRunId run id of the workflow
 * @param workflowUrl url of the workflow endpoint
 * @param stepSettings discovered step-level settings of the next step
 * @param targetStep index used to make the request unique per step
 * @param invokeCount invoke count of the run
 * @param telemetry telemetry to include in the headers
 */
export const publishStepSettingsRedelivery = async ({
  client,
  workflowRunId,
  workflowUrl,
  stepSettings,
  targetStep,
  invokeCount,
  telemetry,
}: {
  client: WorkflowClient;
  workflowRunId: string;
  workflowUrl: string;
  stepSettings: StepSettings;
  targetStep: number;
  invokeCount: number;
  telemetry?: Telemetry;
}) => {
  const { headers } = getHeaders({
    initHeaderValue: "false",
    workflowConfig: {
      workflowRunId,
      workflowUrl,
      telemetry,
    },
    invokeCount,
  });

  await client.publishJSON({
    headers: {
      ...headers,
      ...getStepSettingsHeaders(stepSettings),
      "Upstash-Workflow-CallType": WORKFLOW_DISCOVERY_CALL_TYPE,
    },
    method: "POST",
    body: { discoveryTargetStep: targetStep },
    url: workflowUrl,
  });
};
