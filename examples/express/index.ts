import { serve } from "@upstash/workflow/express";
import express from 'express';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();

app.use(express.json());

const someWork = (input: string) => {
  return `processed: '${JSON.stringify(input)}'`
}

app.use('/workflow', serve<{ message: string }>(async (context) => {
  const input = context.requestPayload

  const result1 = await context.run('step1', async () => {
    const output = someWork(input.message)
    console.log('step 1 input', input, 'output', output)
    return output
  })

  const { body } = await context.call("get-data", {
    url: `${process.env.UPSTASH_WORKFLOW_URL ?? "http://localhost:3001"}/get-data`,
    method: "POST",
    body: { message: result1 }
  })

  await context.run('step2', async () => {
    const message = (body as string)
    const output = someWork(message)
    console.log('step 2 input', result1, 'output', output)
    return output
  })
}, {
  verbose: true,
  retries: 0
}));

app.post("/get-data", (req, res) => {
  res.send("hey there");
});

// here we are

app.use(
  "/test",
  serveQstashWorkflow(async (context: Parameters<RouteFunction<unknown>>[0]) => {
    await context.run("test", async () => {
      // console.log("test");
    });
  }, {
    useJSONContent: true
  })
);

import { IncomingHttpHeaders } from "http";
import { RouteFunction, serve as basicServe, WorkflowServeOptions } from "@upstash/workflow";
import { Request as ExpressRequest, Response, Router } from "express";

function transformHeaders(headers: IncomingHttpHeaders): [string, string][] {
return Object.entries(headers).map(([key, value]) => [
  key,
  Array.isArray(value) ? value.join(", ") : value ?? "",
]);
}

export function serveQstashWorkflow<TInitialPayload = unknown>(
routeFunction: RouteFunction<TInitialPayload>,
options?: Omit<WorkflowServeOptions<globalThis.Response, TInitialPayload>, "onStepFinish">
): Router {
const router = express.Router();

router.post("*", async (req: ExpressRequest, res: Response) => {
  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = transformHeaders(req.headers);

  let reqBody: string | undefined;

  if (req.headers["content-type"]?.includes("text/plain")) {
    reqBody = req.body;
  } else if (req.headers["content-type"]?.includes("application/json")) {
    reqBody = JSON.stringify(req.body);
  }

  const request = new Request(url, {
    headers: headers,
    body: reqBody || "{}",
    method: "POST",
  });

  const { handler: serveHandler } = basicServe<TInitialPayload>(routeFunction, options);

  try {
    const response = await serveHandler(request);

    // Set status code
    res.status(response.status);

    // Set headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Send body
    if (response.body) {
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error in workflow handler:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

return router;
}

app.listen(3001, () => {
  console.log('Server running on port 3001');
});