import { serve } from "../../platforms/express";
import express from 'express';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();

app.use(express.json());

const someWork = (input: string) => {
  return `message: '${JSON.stringify(input)}'`
}

app.use('/workflow', serve<{ message: string }>(async (context) => {
  const input = context.requestPayload
  console.log("input", input);

  const result1 = await context.run('step1', async () => {
    const output = someWork(input.message)
    console.log('step 1 input', input, 'output', output)
    return output
  })

  await context.run('step2', async () => {
    const output = someWork(result1)
    console.log('step 2 input', result1, 'output', output)
  })
}));

app.listen(3001, () => {
  console.log('Server running on port 3001');
});