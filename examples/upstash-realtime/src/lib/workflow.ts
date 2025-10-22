import { Client } from "@upstash/workflow";

export const workflowClient = new Client({ 
  token: process.env.QSTASH_TOKEN!,
});
