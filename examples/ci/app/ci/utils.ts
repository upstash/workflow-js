import {expect} from "bun:test"

import { Client } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import { TestConfig } from "./config";



export type TestPayload<TPayload = unknown> = {
  secret: string,
  payload: TPayload
}

export const CI_SECRET_HEADER = "CI_SECRET"
export const ci_secret = process.env.CI_SECRET!

const deploymentURL = process.env.UPSTASH_WORKFLOW_URL;
if (!deploymentURL) {
  throw new Error("DEPLOYMENT_URL not set");
}

const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN!,
});

export const redisClient = Redis.fromEnv()

/**
 * Given the test config, sends a QStash publish request with
 * destination `${deploymentURL}/${route}`.
 * 
 * Then, sleeps for the duration given in waitForSeconds.
 * 
 * Finally, checks if the secret is set to itself in the redis
 * 
 * @param config 
 */
export const testEndpoint = async <TPayload = unknown>(config: TestConfig<TPayload>) => {
  const secret = Math.ceil(Math.random() * 1000).toString()
  const payload: TestPayload<TPayload> = {
    secret,
    payload: config.payload
  }

  await qstashClient.publishJSON({
    url: `${deploymentURL}/${config.route}`,
    headers: {
      [CI_SECRET_HEADER]: ci_secret,
      ...config.headers
    },
    body: JSON.stringify(payload)
  })

  await new Promise(r => setTimeout(r, 1000 * config.waitForSeconds));

  const result = await redisClient.get(secret)
  expect(result).toBe(secret)
}

export const getPayload = <TPayload = unknown>(workflowPayload: TestPayload<TPayload>) => {
  return {
    payload: workflowPayload.payload,
    finish: async () => {
      await redisClient.set(workflowPayload.secret, workflowPayload.secret)
    }
  }
}