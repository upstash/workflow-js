import {
  WORKFLOW_FAILURE_HEADER,
  WORKFLOW_PROTOCOL_VERSION,
  WORKFLOW_PROTOCOL_VERSION_HEADER,
} from "../constants";
import { WorkflowError } from "../error";
import { Claim } from "../types";

export const getClaim = ({ headers }: { headers: Request["headers"] }): Claim => {
  if (!headers.get(WORKFLOW_PROTOCOL_VERSION_HEADER)) {
    return "first-invocation";
  }

  const versionHeader = headers.get(WORKFLOW_PROTOCOL_VERSION_HEADER);
  if (versionHeader !== WORKFLOW_PROTOCOL_VERSION) {
    throw new WorkflowError(
      `Incompatible workflow sdk protocol version. Expected ${WORKFLOW_PROTOCOL_VERSION},` +
        ` got ${versionHeader} from the request.`
    );
  }

  if (headers.get(WORKFLOW_FAILURE_HEADER) === "true") {
    return "failure-callback";
  } else if (headers.get("Upstash-Workflow-Callback")) {
    return "callback";
  } else {
    return "regular";
  }
};
