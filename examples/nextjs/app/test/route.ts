import { z } from "zod"
import { serve } from "../../../../platforms/nextjs";

const mySchema = z.string();

export const { POST } = serve<string>(async (context) => {
	await context.run("myFunction", async () => {
		console.log("Hello")
		return "hey"
	})
}, {
	schema: mySchema
})