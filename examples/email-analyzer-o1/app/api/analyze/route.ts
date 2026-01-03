import { serve } from "@upstash/workflow/nextjs"
import pdf from "pdf-parse"
import { Client as QStashClient } from '@upstash/qstash';


type EmailPayload = {
	message: string,
	subject: string,
	to: string
	attachment?: string,
}

function getQStashClient(): QStashClient {
	const token = process.env.QSTASH_TOKEN;
  
	if (!token) {
	  throw new Error(
		'QSTASH_TOKEN environment variable is required'
	  );
	}
  
	return new QStashClient({
	  token,
	  headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
		? {
			'Upstash-Forward-X-Vercel-Protection-Bypass':
			  process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
			'x-vercel-protection-bypass':
			  process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
		  }
		: undefined,
	});
  }

export const { POST } = serve<EmailPayload>(async (context) => {
	const { message, subject, to, attachment } = context.requestPayload;

	const pdfContent = await context.run("Process PDF Attachment", async () => {
		if (!attachment) {
			return '';
		}

		// Download file
		const response = await fetch(attachment);
		const fileContent = await response.arrayBuffer();
		const buffer = Buffer.from(fileContent);

		// Parse PDF
		try {
			const data = await pdf(buffer);
			console.log(data)
			return data.text;
		} catch (error) {
			console.error('Error parsing PDF:', error);
			return 'Unable to extract PDF content';
		}
	});

	const aiResponse = await context.api.openai.call("get ai response", {
		token: process.env.OPENAI_API_KEY!,
		operation: "chat.completions.create",
		body: {
			model: "o1",
			messages: [
				{
					role: "system",
					content: `You are an AI assistant that writes email responses. Write a natural, professional response 
                       that continues the email thread. The response should be concise but helpful, maintaining 
                       the flow of the conversation.`
				},
				{
					role: "user",
					content: `
                       Here's the email thread context. Please write a response to this email thread that addresses the latest message:
                       ${message}.

					   Here's the pdf attachment, if exists:
					   ${pdfContent}
					   `,
				}
			],
		},
	})

	await context.api.resend.call("Send LLM Proposal", {
		token: process.env.RESEND_API_KEY!,
		body: {
			from: "Acme <onboarding@resend.dev>",
			to,
			subject,
			text: aiResponse.body.choices[0].message.content
		}
	})
},
{
	qstashClient: getQStashClient(),
})
