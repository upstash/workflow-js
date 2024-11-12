import { servePagesRouter } from "@upstash/workflow/nextjs";

const someWork = (input) => {
  return `processed '${JSON.stringify(input)}'`
}

const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.UPSTASH_WORKFLOW_URL
    ? process.env.UPSTASH_WORKFLOW_URL
    : "http://localhost:3001"

const endpointUrl = `${baseUrl}/api/workflow`

const { handler } = servePagesRouter(
  async (context) => {
    const input = context.requestPayload
    const result1 = await context.run("step1", async () => {
      const output = someWork(input)
      console.log("step 1 input", input, "output", output)
      return output
    });

    await context.run("step2", async () => {
      const output = someWork(result1)
      console.log("step 2 input", result1, "output", output)
    });
  },
  {
    url: endpointUrl
  }
)

export default handler
