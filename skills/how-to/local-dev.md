# Local Development for Upstash Workflow

This documentation explains how to run Upstash Workflow locally using the QStash development server and how to expose your local app using a public tunnel such as ngrok. It focuses on practical usage and TypeScript integration.

## Overview

Upstash Workflow uses Upstash QStash under the hood. During development you can:

- Run a **local QStash development server** to simulate workflow behavior entirely offline.
- Optionally expose your local server using **ngrok** if you want to test with the production QStash.

Both approaches require updating environment variables and ensuring your workflow trigger URLs correctly reference your local or tunnel address.

---

## 1. Start the QStash Local Development Server

Use the QStash CLI:

```
npx @upstash/qstash-cli dev
```

The CLI prints:

- QSTASH_TOKEN
- QSTASH_CURRENT_SIGNING_KEY
- QSTASH_NEXT_SIGNING_KEY
- Local server URL (default: `http://127.0.0.1:8080`)

Set these values in your `.env` file so your workflow client uses the local environment.

---

## 2. Set Local Environment Variables

Use the environment values printed by the CLI:

```
QSTASH_URL="http://127.0.0.1:8080"
QSTASH_TOKEN="<token-from-cli>"
QSTASH_CURRENT_SIGNING_KEY="<cur-key>"
QSTASH_NEXT_SIGNING_KEY="<next-key>"
```

These ensure all workflow requests are routed locally.

---

## 3. Trigger Workflows Using Local URLs

A common pattern is determining the base URL dynamically based on environment variables. Below is an example that demonstrates:

- Local development (localhost)
- Production deployments (auto-detected env)

```ts
import { Client } from "@upstash/workflow";

const client = Client();

// In production, Vercel sets VERCEL_URL. Otherwise use localhost.
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `http://localhost:3000`;

// Trigger a workflow with retries
const { workflowRunId } = await client.trigger({
  url: `${BASE_URL}/api/workflow`, // Local or production
  retries: 3, // Optional retry logic
});

console.log("Workflow run:", workflowRunId);
```

**Common mistakes:**

- Forgetting to include the full URL including `http://` or `https://`.
- Using a production URL while the local QStash server is running.
- Missing environment variables.

---

## 4. Using ngrok (Optional)

If your workflow must be reachable from the managed Upstash servers (not local), expose your local server publicly.

### Install & authenticate

```
ngrok config add-authtoken <YOUR-AUTH-TOKEN>
```

### Start a tunnel

```
ngrok http 3000
```

ngrok outputs a public URL:

```
Forwarding  https://1234abcd.ngrok.io -> http://localhost:3000
```

Use this public URL instead of localhost:

```ts
const BASE_URL = "https://1234abcd.ngrok.io"; // Public tunnel

await client.trigger({
  url: `${BASE_URL}/api/workflow`,
  retries: 3,
});
```

**Pitfall:** Your ngrok port must match your dev server port, otherwise all workflow calls will fail.

---

## Summary

- Start QStash locally using `qstash-cli dev`.
- Copy generated environment variables into `.env`.
- Use local URLs in TypeScript clients while developing.
- Optionally expose your server with ngrok if you need remote access.

This setup ensures fast workflow iteration without deploying your app.
