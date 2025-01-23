import { serve } from "@upstash/workflow/nextjs";
import { SerpAPIClient } from '@agentic/serpapi';
import { FirecrawlClient } from '@agentic/firecrawl';

import { tool } from 'ai';
import { z } from "zod";

const serpapi = new SerpAPIClient();
const firecrawl = new FirecrawlClient();

export const { POST } = serve(async (context) => {
    const model = context.agents.openai('gpt-4-turbo');

    // Search specialist agent with limited results
    const searchAgent = context.agents.agent({
        model,
        name: 'searchAgent',
        maxSteps: 3,
        background: 'You are a search specialist focused on finding the 2-3 most relevant and recent articles. Only return the most significant findings.',
        tools: {
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
                        .slice(0, 2) // Limit to top 2 results
                        .map(result => `Title: ${result.title}\nKey Points: ${result.snippet}\nSource: ${result.link}`)
                        .join('\n\n');
                    return { content };
                }
            })
        }
    });

    // Content specialist agent with focused analysis
    const contentAgent = context.agents.agent({
        model,
        name: 'contentAgent',
        maxSteps: 3,
        background: 'You are a content specialist who provides brief, focused summaries. Extract only the most important insights in 2-3 sentences per article.',
        tools: {
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
    });

    // Synthesis agent for concise overview
    const synthesisAgent = context.agents.agent({
        model,
        name: 'synthesisAgent',
        maxSteps: 2,
        background: 'You are a synthesis specialist who creates very concise summaries. Focus on the 3-4 most important takeaways overall.',
        tools: {}
    });

    // Step 1: Search for relevant content
    const searchResults = await context.agents.task({
        agent: searchAgent,
        prompt: "Find the 2-3 most significant recent developments in science and technology. Focus only on major breakthroughs or innovations.",
    }).run()


    // Step 2: Brief analysis of articles
    const contentAnalysis = await context.agents.task({
        agent: contentAgent,
        prompt: `Provide a brief, focused analysis of each article. Extract only the most important point from each: ${searchResults.text}`
    }).run();


    // Step 3: Concise synthesis
    const synthesis = await context.agents.task({
        agent: synthesisAgent,
        prompt: `Create a brief synthesis (max 3-4 sentences) highlighting only the most significant findings: ${contentAnalysis.text}`
    }).run();

    await context.run("log", async () => {
        console.log("Synthesis regarding scientific hot topics", synthesis)
    })
});