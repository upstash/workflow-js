import { serve } from "@upstash/workflow/nextjs";
import { SerpAPIClient } from '@agentic/serpapi';
import { FirecrawlClient } from '@agentic/firecrawl';
import OpenAI from 'openai';
import { tool } from 'ai';
import { z } from "zod";
import { Redis } from "@upstash/redis"


const redis = Redis.fromEnv();
const serpapi = new SerpAPIClient();
const firecrawl = new FirecrawlClient();
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY
});

type Payload = {
	productWebsite: string;
	productDetails: string;
}

export const { POST } = serve<Payload>(async (context) => {
	const { productDetails, productWebsite } = context.requestPayload
	const model = context.agents.openai('gpt-4-turbo');

	const productAnalysisAgent = context.agents.agent({
		model,
		name: 'productAnalysisAgent',
		maxSteps: 3,
		background: `You are a Lead Market Analyst at a premier digital marketing firm. 
					 You specialize in dissecting online business landscapes and providing 
					 in-depth insights to guide marketing strategies.`,
		tools: {
			searchWeb: tool({
				description: 'Search the web using SerpAPI',
				parameters: z.object({
					query: z.string().describe('The search query')
				}),
				execute: async ({ query }) => {
					const results = await serpapi.search(query);
					const organicResults = results.organic_results || [];
					return {
						content: organicResults
							.slice(0, 3)
							.map(result => `Title: ${result.title}\nKey Points: ${result.snippet}\nSource: ${result.link}`)
							.join('\n\n')
					};
				}
			}),
			scrapeWebsite: tool({
				description: 'Scrape content from a webpage',
				parameters: z.object({
					url: z.string().describe('The URL to scrape')
				}),
				execute: async ({ url }) => {
					const result = await firecrawl.scrapeUrl({ url });
					return { content: result.data };
				}
			})
		}
	});

	// Strategy Planner Agent
	const strategyPlannerAgent = context.agents.agent({
		model,
		name: 'strategyPlannerAgent',
		maxSteps: 3,
		background: `You are the Chief Marketing Strategist at a leading digital marketing agency,
					 known for crafting bespoke strategies that drive success.`,
		tools: {
			searchInstagram: tool({
				description: 'Search Instagram trends',
				parameters: z.object({
					query: z.string().describe('The search query')
				}),
				execute: async ({ query }) => {
					const results = await serpapi.search(`site:instagram.com ${query}`);
					return { content: results.organic_results?.slice(0, 3) || [] };
				}
			})
		}
	});

	const creativeAgent = context.agents.agent({
		model,
		name: 'creativeAgent',
		maxSteps: 3,
		background: `You are a Creative Content Creator who excels in crafting narratives
					 that resonate with social media audiences.`,
		tools: {}
	});

	const photographerAgent = context.agents.agent({
		model,
		name: 'photographerAgent',
		maxSteps: 2,
		background: `You are a Senior Photographer specialized in creating compelling
					 visual narratives for social media campaigns.`,
		tools: {}
	});

	const photoGenerator = context.agents.agent({
		model,
		name: 'photoGenerator',
		maxSteps: 3,
		background: `You are an AI image generation specialist who creates detailed, 
					 professional prompts for generating Instagram-worthy photos.`,
		tools: {
			generateImage: tool({
				description: 'Generate an image using DALL-E',
				parameters: z.object({
					prompt: z.string().describe('The image generation prompt'),
					caption: z.string().describe('The Instagram caption'),
					style: z.string().optional().describe('The style of the image')
				}),
				execute: async ({ prompt, style, caption }) => {
					try {
						const response = await openai.images.generate({
							model: "dall-e-3",
							prompt: `${prompt}${style ? `. Style: ${style}` : ''}. Make it look professional and Instagram-worthy.`,
							n: 1,
							size: "1024x1024",
							quality: "hd",
							style: "natural"
						});

						const result = {
							imageUrl: response.data[0].url,
							prompt,
							caption
						};

						const callKey = context.headers.get('callKey');
						if (callKey) {
							await redis.lpush(
								`${callKey}-posts`,
								JSON.stringify(result)
							);
						}

						return result;


					} catch (error) {
						console.error('Image generation error:', error);
						throw new Error('Failed to generate image');
					}
				}
			})
		}
	});

	const productAnalysis = await context.agents.task({
		agent: productAnalysisAgent,
		prompt: `Analyze the product website: ${productWebsite}. 
				Additional details: ${productDetails}
				Focus on identifying unique features, benefits, and overall narrative.`
	}).run();

	const marketAnalysis = await context.agents.task({
		agent: productAnalysisAgent,
		prompt: `Analyze competitors of ${productWebsite}.
				Identify top 3 competitors and their strategies.
				Consider: ${productAnalysis.text}`
	}).run();

	const campaignStrategy = await context.agents.task({
		agent: strategyPlannerAgent,
		prompt: `Develop a marketing campaign strategy based on:
				Product Analysis: ${productAnalysis.text}
				Market Analysis: ${marketAnalysis.text}
				Create a strategy that will resonate with the target audience.`
	}).run();

	const instagramCaptions = await context.agents.task({
		agent: creativeAgent,
		prompt: `Create exactly 3 engaging Instagram post captions based on:
				Campaign Strategy: ${campaignStrategy.text}
				Make them punchy, captivating, and aligned with the strategy. Dont use emojis or special characters.
				Return exactly 3 distinct copies, no more and no less.`
	}).run();

	const photoDescription = await context.agents.task({
		agent: photographerAgent,
		prompt: `Create exactly 3 detailed photo concepts for Instagram posts using:
				Captions: ${instagramCaptions.text}
				Product: ${productWebsite}
				Details: ${productDetails}
				Format each description like: "high tech airplane in beautiful blue sky at sunset, 4k, professional wide shot"
				Return exactly 3 concepts, no more and no less.`
	}).run();

	// 2. Limit the array to 3 items when splitting
	const photoPrompts = photoDescription.text.split('\n\n').slice(0, 3);

	// 3. Generate exactly 3 images in parallel
	await Promise.all(
		photoPrompts.slice(0, 3).map(async (prompt) =>
			await context.agents.task({
				agent: photoGenerator,
				prompt: `Generate a professional Instagram photo based on this description: "${prompt}". 
              Make it visually appealing and suitable for social media.`
			}).run()
		)
	);
}, {
	baseUrl: "https://5db5-85-101-27-246.ngrok-free.app"
})