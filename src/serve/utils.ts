import { WorkflowContext } from "../context";
import { DisabledWorkflowContext } from "./authorization";


/**
 * Checks if a context is a DisabledWorkflowContext.
 *
 * @param context workflow context to check
 */
export const isDisabledWorkflowContext = (context: WorkflowContext | DisabledWorkflowContext) => {
  return "disabled" in context;
};
