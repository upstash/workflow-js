import { Client } from "@upstash/qstash";
import { checkWorkflowStart } from "app/ci/upstash/qstash";

const c = new Client({
  token: "eyJVc2VySUQiOiJ0ZXN0VXNlciIsIlBhc3N3b3JkIjoidGVzdFBhc3N3b3JkIn0=",
  baseUrl: "http://127.0.0.1:8000"
})

const {messageId} = await c.publishJSON({
  url: "https://requestcatcher.com",
})

await checkWorkflowStart(messageId)