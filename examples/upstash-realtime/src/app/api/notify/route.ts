import { NextRequest, NextResponse } from "next/server";
import { workflowClient } from "@/lib/workflow";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, eventData } = body;

    if (!eventId) {
      return NextResponse.json(
        { success: false, error: "eventId is required" },
        { status: 400 }
      );
    }

    await workflowClient.notify({
      eventId,
      eventData,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error notifying workflow:", error);
    return NextResponse.json(
      { success: false, error: "Failed to notify workflow" },
      { status: 500 }
    );
  }
}
