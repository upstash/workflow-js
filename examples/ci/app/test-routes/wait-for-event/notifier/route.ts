import { Client } from "@upstash/workflow"
import { NOTIFIER_SECRET, NotifierWorkflowConfig, SDK_EVENT_DATA } from "../constants"
import { waitUntil } from '@vercel/functions';

const client = new Client({ baseUrl: process.env.QSTASH_URL, token: process.env.QSTASH_TOKEN! })

export const POST = async (request: Request) => {
  if (!NOTIFIER_SECRET) {
    return new Response("secret not set", { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${NOTIFIER_SECRET}`) {
    return new Response("unauthorized.", { status: 401 } )
  }

  const { sdkEventId } = await request.json() as Pick<NotifierWorkflowConfig, "sdkEventId">

  const sleepAndNotify = async () => {
    
    await new Promise(r => setTimeout(r, 3000));
    
    const result = await client.notify({
      eventId: sdkEventId,
      eventData: SDK_EVENT_DATA
    })
    
    if (!result.length) {
      console.error("failed to notify workflow.")
    }
  }

  waitUntil(sleepAndNotify())
  return new Response("notifying...", { status: 200 })
}
