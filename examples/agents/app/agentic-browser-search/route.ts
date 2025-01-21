import { serve } from "@upstash/workflow/nextjs";
import { SerpAPIClient } from '@agentic/serpapi';
import { FirecrawlClient } from '@agentic/firecrawl';
import { tool } from 'ai';
import { z } from "zod";

const serpapi = new SerpAPIClient();
const firecrawl = new FirecrawlClient();

const searchTools = {
	searchWeb: tool({
		description: 'Search the web using SerpAPI',
		parameters: z.object({
			query: z.string().describe('The search query')
		}),
		execute: async ({ query }) => {
			console.log('Searching for:', query);
			const results = await serpapi.search(query);
			console.log(results);
			const organicResults = results.organic_results || [];
			const content = organicResults
				.slice(0, 5)
				.map(result => `Title: ${result.title}\nSnippet: ${result.snippet}\nURL: ${result.link}`)
				.join('\n\n');
			return { content };
		}
	}),
	scrapeContent: tool({
		description: 'Scrape content from a webpage using Firecrawl',
		parameters: z.object({
			url: z.string().describe('The URL to scrape content from')
		}),
		execute: async ({ url }) => {
			const result = await firecrawl.scrapeUrl({ url });
			return { content: result.data };
		}
	})
}

export const { POST } = serve(async (context) => {
	const model = context.agents.openai('gpt-3.5-turbo');

	// Search specialist agent
	const searchAgent = context.agents.agent({
		model,
		name: 'searchAgent',
		maxSteps: 10,
		background: 'You are a search specialist. Find relevant articles and extract their URLs.',
		tools: {
			searchWeb: searchTools.searchWeb
		}
	});

	// Content specialist agent
	const contentAgent = context.agents.agent({
		model,
		name: 'contentAgent',
		maxSteps: 10,
		background: 'You are a content specialist who analyzes articles in detail and extracts key insights.',
		tools: {
			scrapeContent: searchTools.scrapeContent
		}
	});

	// Synthesis agent
	const synthesisAgent = context.agents.agent({
		model,
		name: 'synthesisAgent',
		maxSteps: 10,
		background: 'You are a synthesis specialist who combines information into clear insights.',
		tools: {}
	});

	// Step 1: Search for relevant content
	const searchTask = context.agents.task({
		agent: searchAgent,
		prompt: "Search for 5 different topics in science and technology",
	})

	const searchResults = await searchTask.run();

	await context.run("log", async () => {
		console.log("SEARCH RESULTS - ", searchResults)
	})

	// Step 2: Analyze each article
	const contentAnalysis = await context.agents.task({
		agent: contentAgent,
		prompt: `Analyze these articles in detail and extract key information: ${searchResults.text}`
	}).run();

	await context.run("log", async () => {
		console.log("CONTENT ANALYSIS - ", contentAnalysis)
	})

	// Step 3: Synthesize findings
	const synthesis = await context.agents.task({
		agent: synthesisAgent,
		prompt: `Create a comprehensive synthesis of these findings: ${contentAnalysis.text}`
	}).run();

	await context.run("log", async () => {
		console.log("SEARCH RESULTS", searchResults)
		console.log("CONTENT ANALYSIS", contentAnalysis)
		console.log("SYNTHESIS", synthesis)
	})
}, {
	baseUrl: "https://9db3-85-101-27-246.ngrok-free.app"
});