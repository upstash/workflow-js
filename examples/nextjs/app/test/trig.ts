import { invokeWorkflow } from "./[[...route]]/route";

invokeWorkflow({
	function: "workflow1",
	payload: {
		key: "value"
	}
})