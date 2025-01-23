import { serve } from "@upstash/workflow/nextjs";
import { tool } from 'ai';
import { z } from "zod";
import { chromium } from 'playwright-core';
import { convert } from 'html-to-text';

// Tool definitions
const searchTools = {
    kayakSearch: tool({
        description: 'Generate Kayak URL for flight search',
        parameters: z.object({
            departure: z.string().describe('IATA code for departure airport'),
            destination: z.string().describe('IATA code for destination airport'),
            date: z.string().describe('Flight date in YYYY-MM-DD format'),
            returnDate: z.string().optional().describe('Return flight date in YYYY-MM-DD format')
        }),
        execute: async ({ departure, destination, date, returnDate }) => {
            console.log(`Generating Kayak URL for ${departure} to ${destination} on ${date}`);
            let url = `https://www.kayak.com/flights/${departure}-${destination}/${date}`;
            if (returnDate) {
                url += `/${returnDate}`;
            }
            url += "?currency=USD";
            return { content: url };
        }
    }),
    browserbase: tool({
        description: 'Load and extract content from URL using Browserbase',
        parameters: z.object({
            url: z.string().describe('The URL to load')
        }),
        execute: async ({ url }) => {
            const browser = await chromium.connectOverCDP(
                `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`
            );
            const context = browser.contexts()[0];
            const page = context.pages()[0];

            await page.goto(url);
            await page.waitForTimeout(25000);

            const content = await page.content();
            const text = convert(content, {
                wordwrap: 130,
                preserveNewlines: true
            });

            await browser.close();
            return { content: text };
        }
    })
};

export const { POST } = serve(async (context) => {
    const model = context.agents.openai('gpt-4');


    const flightAgent = context.agents.agent({
        model,
        name: 'flightAgent',
        maxSteps: 10,
        background: 'You are a flight search specialist who finds and analyzes flight options.',
        tools: searchTools
    });

    const summaryAgent = context.agents.agent({
        model,
        name: 'summaryAgent',
        maxSteps: 5,
        background: 'You are a specialist in summarizing flight information into clear, actionable formats.',
        tools: {}
    });

    // Get current date for context
    const currentYear = new Date().getFullYear();

    // Step 1: Search for flights
    const searchResults = await context.agents.task({
        agent: flightAgent,
        prompt: `Search for flights from San Francisco to New York on September 21st, ${currentYear}. 
                Return the top 5 flights with their details including price, duration, and booking links.`
    }).run();

    await context.run("log", async () => {
        console.log("SEARCH RESULTS - ", searchResults)
    });

    // Step 2: Get detailed booking provider information
    const providerResults = await context.agents.task({
        agent: flightAgent,
        prompt: `For each flight in the search results, find available booking providers:
                ${searchResults.text}`
    }).run();

    await context.run("log", async () => {
        console.log("PROVIDER RESULTS - ", providerResults)
    });

    // Step 3: Create final summary
    const summary = await context.agents.task({
        agent: summaryAgent,
        prompt: `Create a comprehensive summary of the flight options and booking providers:
                Search Results: ${searchResults.text}
                Provider Details: ${providerResults.text}
                
                Format as a clear list with all important details and booking links.`
    }).run();

    await context.run("log", async () => {
        console.log("FINAL SUMMARY", summary)
    });
});