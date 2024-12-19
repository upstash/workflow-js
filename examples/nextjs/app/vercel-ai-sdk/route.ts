import { createOpenAI } from '@ai-sdk/openai';
import { WorkflowContext } from '@upstash/workflow';
import { QStashWorkflowAbort } from '@upstash/qstash';
import { HTTPMethods } from '@upstash/qstash';
import { generateText, tool, ToolExecutionError } from 'ai';
import { z } from 'zod';
import { serve } from "@upstash/workflow/nextjs";

const createWorkflowOpenAI = (context: WorkflowContext) => {
	return createOpenAI({
		apiKey: process.env.OPENAI_API_KEY ?? "",
		compatibility: "strict",
		fetch: async (input, init) => {
			try {
				// Prepare headers from init.headers
				const headers = init?.headers
					? Object.fromEntries(new Headers(init.headers).entries())
					: {};

				// Prepare body from init.body
				const body = init?.body ? JSON.parse(init.body as string) : undefined;

				// Call the workflow context
				const responseInfo = await context.call("call step", {
					url: input.toString(),
					method: init?.method as HTTPMethods,
					headers,
					body,
				});

				// Construct headers for the response
				const responseHeaders = new Headers(
					Object.entries(responseInfo.header).reduce((acc, [key, values]) => {
						acc[key] = values.join(", ");
						return acc;
					}, {} as Record<string, string>)
				);

				// Return the constructed response
				return new Response(JSON.stringify(responseInfo.body), {
					status: responseInfo.status,
					headers: responseHeaders,
				});
			} catch (error) {
				if (error instanceof QStashWorkflowAbort) {
					throw error
				} else {
					console.error("Error in fetch implementation:", error);
					throw error; // Rethrow error for further handling
				}
			}
		},
	});
};

export const { POST } = serve<{ prompt: string }>(async (context) => {

	const openai = createWorkflowOpenAI(context)

	const prompt = await context.run("get prompt", async () => {
		return context.requestPayload.prompt
	})

	try {
		const result = await generateText({
			model: openai('gpt-3.5-turbo'),

			maxTokens: 2048,
			tools: {
				weather: tool({
					description: 'Get the weather in a location',
					parameters: z.object({
						latitude: z.number(),
						longitude: z.number(),
					}),
					execute: async ({ latitude, longitude }) => context.call("weather tool", {
						url: `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`,
						method: 'GET',
					})
				}),
				cityAttractions: tool({
					description: 'Get tourist attractions in a city',
					parameters: z.object({
						city: z.string().describe('The city to get attractions for')
					}),
					execute: async ({ city }) => context.call("attractions tool", {
						url: 'https://places.googleapis.com/v1/places:searchText',
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY ?? "",
							'X-Goog-FieldMask': 'places.displayName,places.formattedAddress'
						},
						body: {
							textQuery: `tourist attractions in ${city}`
						}
					})
				}),
			},
			prompt,
			maxSteps: 6
		});
		await context.run("text", () => {
			console.log(`TEXT: ${result.text}`);
			return result.text
		})

	} catch (error) {
		if (error instanceof ToolExecutionError && error.cause instanceof QStashWorkflowAbort) {
			throw error.cause
		} else {
			throw error
		}
	}
})