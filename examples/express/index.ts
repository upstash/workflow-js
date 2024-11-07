import { serve } from "../../platforms/express";
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
    url: `${process.env.UPSTASH_WORKFLOW_URL}/get-data`,
    method: "POST",
    body: { message: result1 }
  })

  await context.run('step2', async () => {
    const { message } = (body as { message: string })
    const output = someWork(message)
    console.log('step 2 input', result1, 'output', output)
    return output
  })
}));

app.post("/get-data", (req, res) => {
  // Log the incoming request body for debugging
  console.log('get-data received:', req.body);

  // Send back the message
  res.json(req.body);
});



app.listen(3001, () => {
  console.log('Server running on port 3001');
});