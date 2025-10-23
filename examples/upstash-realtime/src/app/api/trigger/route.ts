import { NextRequest, NextResponse } from "next/server";
import { workflowClient } from "@/lib/workflow";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowType } = body;

    if (!workflowType || (workflowType !== "basic" && workflowType !== "human-in-loop")) {
      return NextResponse.json(
        { error: "Invalid workflowType. Must be 'basic' or 'human-in-loop'" },
        { status: 400 }
      );
    }

    // Determine the workflow URL based on the type
    const workflowUrl = `${request.nextUrl.origin}/api/workflow/${workflowType}`;

    // Trigger the workflow
    const { workflowRunId } = await workflowClient.trigger({
      url: workflowUrl,
      body: {
        userId: "user-123",
        action: workflowType === "basic" ? "process-data" : "approve-action",
      },
    });

    return NextResponse.json({ workflowRunId });
  } catch (error) {
    console.error("Error triggering workflow:", error);
    return NextResponse.json(
      { error: "Failed to trigger workflow" },
      { status: 500 }
    );
  }
}
