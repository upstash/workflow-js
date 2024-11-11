import { Receiver } from "@upstash/qstash";
import { servePagesRouter } from "@upstash/workflow/nextjs";
import { NextApiRequest } from "next";

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`
}

// export const config = {
//   api: {
//     bodyParser: false
//   },
//   maxDuration: 5,
// }


const { handler } = servePagesRouter<{ hello: string }>(
  async (context) => {
    const input = context.requestPayload.hello
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
    receiver: new Receiver({
      currentSigningKey: "sig_7mYmu9f6mhTXU1tJtPKPtrUHgywu",
      nextSigningKey: "sig_5GeRyvDD1yBfrQ1srd3c4s5tmFxR"
    })
  }
)

export default async (req: NextApiRequest, res) => {
  // console.log("ENV", process.env);
  // console.log("HEADERS", req.headersDistinct);
  console.log("BODY TYPE", typeof req.body);
  // console.log("BODY", req.body);
  
  
  return await handler(req, res)
}