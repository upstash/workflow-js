import { WorkflowContext } from "../context";
import { DisabledWorkflowContext } from "./authorization";

export const isDisabledWorkflowContext = (context: WorkflowContext | DisabledWorkflowContext) => {
  return "disabled" in context;
};
