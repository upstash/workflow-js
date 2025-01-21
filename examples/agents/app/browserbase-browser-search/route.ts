import { serve } from "@upstash/workflow/nextjs";

import { chromium } from 'playwright-core';
import { tool } from 'ai'
import { z } from "zod"
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

// Get the debug URL for a Browserbase session
async function getDebugUrl(id: string) {
	const response = await fetch(
		`https://api.browserbase.com/v1/sessions/${id}/debug`,
		{
			method: "GET",
			headers: {
				"x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
				"Content-Type": "application/json",
			},
		},
	);
	const data = await response.json();
	return data;
}

// Create a new Browserbase session
async function createSession() {
	const response = await fetch(`https://api.browserbase.com/v1/sessions`, {
		method: "POST",
		headers: {
			"x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			projectId: process.env.BROWSERBASE_PROJECT_ID,
			keepAlive: true,
		}),
	});
	const data = await response.json();
	return { id: data.id, debugUrl: data.debugUrl };
}



const browserbaseTools = {
	googleSearch: tool({
		description: 'Search Google for a query',
		parameters: z.object({
			query: z.string().describe('The search query'),
			sessionId: z.string().describe('The Browserbase session ID')
		}),
		execute: async ({ query, sessionId }) => {
			const debugUrl = await getDebugUrl(sessionId);
			const browser = await chromium.connectOverCDP(debugUrl.debuggerFullscreenUrl);
			const defaultContext = browser.contexts()[0];
			const page = defaultContext.pages()[0];

			await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
			await page.waitForLoadState('load', { timeout: 10000 });
			await page.waitForSelector('.g');

			const results = await page.evaluate(() => {
				const items = document.querySelectorAll('.g');
				return Array.from(items).map(item => {
					const title = item.querySelector('h3')?.textContent || '';
					const description = item.querySelector('.VwiC3b')?.textContent || '';
					const url = item.querySelector('a')?.href || '';
					return { title, description, url };
				});
			});

			await browser.close();
			return {
				content: results.slice(0, 3).map(r => `${r.title}\n${r.description}\n${r.url}`).join('\n\n')
			};
		}
	}),
	getPageContent: tool({
		description: 'Get the content of a page using Playwright',
		parameters: z.object({
			url: z.string().describe('The URL to fetch content from'),
			sessionId: z.string().describe('The Browserbase session ID')
		}),
		execute: async ({ url, sessionId }) => {
			const debugUrl = await getDebugUrl(sessionId);
			const browser = await chromium.connectOverCDP(debugUrl.debuggerFullscreenUrl);
			const defaultContext = browser.contexts()[0];
			const page = defaultContext.pages()[0];

			await page.goto(url, { waitUntil: 'networkidle' });
			const content = await page.content();

			const dom = new JSDOM(content);
			const reader = new Readability(dom.window.document);
			const article = reader.parse();

			const extractedContent = article
				? `${article.title}\n\n${article.textContent}`
				: await page.evaluate(() => document.body.innerText);

			await browser.close();
			return { content: extractedContent };
		}
	}),
	createSession: tool({
		description: 'Create a new Browserbase session',
		parameters: z.object({}),
		execute: async () => {
			const session = await createSession();
			const debugUrl = await getDebugUrl(session.id);
			return { sessionId: session.id, debugUrl: debugUrl.debuggerFullscreenUrl, toolName: 'Creating a new session' };
		},
	}),
}

export const { POST } = serve(async (context) => {


	const model = context.agents.openai('gpt-4');

	// Search specialist agent
	const searchAgent = context.agents.agent({
		model,
		name: 'searchAgent',
		maxSteps: 2,
		background: 'You are a search specialist. Find the most relevant articles and extract their URLs.',
		tools: browserbaseTools
	});

	// Content specialist agent
	const contentAgent = context.agents.agent({
		model,
		name: 'contentAgent',
		maxSteps: 2,
		background: 'You are a content specialist who analyzes articles in detail and extracts key insights.',
		tools: browserbaseTools
	});

	// Synthesis agent
	const synthesisAgent = context.agents.agent({
		model,
		name: 'synthesisAgent',
		maxSteps: 2,
		background: 'You are a synthesis specialist who combines information into clear insights.',
		tools: {}
	});

	// Step 1: Search for relevant content
	const searchResults = await context.agents.task({
		agent: searchAgent,
		prompt: "Search for 'Latest developments in quantum computing 2024' and return the most relevant articles",

	}).run();

	// Step 2: Analyze each article
	const contentAnalysis = await context.agents.task({
		agent: contentAgent,
		prompt: `Analyze these articles in detail and extract key information: ${searchResults.text}`,
	}).run();

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
});