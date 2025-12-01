import { Client } from "@upstash/workflow";
import { NextRequest, NextResponse } from "next/server";

const workflowClient = new Client({
  baseUrl: process.env.QSTASH_URL!,
  token: process.env.QSTASH_TOKEN!,
})

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { eventId, eventData } = body;

  if (!eventId) {
    return NextResponse.json(
      { success: false, error: "eventId is required" },
      { status: 400 }
    );
  }

  // Notify the workflow
  await workflowClient.notify({
    eventId,
    eventData,
  });

  return NextResponse.json({ success: true });
}