"use server"

import { Client as WorkflowClient } from '@upstash/workflow';

type EmailPayload = {
  message: string;
  subject: string;
  to: string;
  attachment?: string;
}

function getWorkflowClient(): WorkflowClient {
  const token = process.env.QSTASH_TOKEN;

  if (!token) {
    throw new Error(
      'QSTASH_TOKEN environment variable is required'
    );
  }

  return new WorkflowClient({
    token,
    // VERCEL AUTOMATION BYPASS SECRET is used to bypass the verification of the request
    headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'Upstash-Forward-X-Vercel-Protection-Bypass':
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          'x-vercel-protection-bypass':
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        }
      : undefined,
  });
}

export async function triggerEmailAnalysis(formData: EmailPayload) {
  try {
    const workflowClient = getWorkflowClient()

    const result = await workflowClient.trigger({
      url: `${process.env.UPSTASH_WORKFLOW_URL ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/analyze`,
      body: formData,
    });

    return { success: true, workflowRunId: result.workflowRunId };
  } catch (error) {
    console.error('Error triggering workflow:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to trigger workflow'
    };
  }
}
