export const CODES = {
  Wikipedia: `const wikipediaAgent = context.agents.agent({
  model,
  name: "wikipediaAgent",
  maxSteps: 2,
  background:
    "You are an agent that can answer questions by querying Wikipedia " +
    "and provide a summary of the answer with references to the next agent. " +
    "If you can't get the answer from Wikipedia, return not found instead.",
  tools: {
    wikiTool: new WikipediaQueryRun({
      topKResults: 3,
      maxDocContentLength: 4000,
    }),
  },
});
`,
  WolframAlpha: `const wolframAlphaAgent = context.agents.agent({
  model,
  name: "wolframAlphaAgent",
  maxSteps: 2,
  background:
    "You are an agent that can answer questions by querying Wolfram Alpha, " +
    "and provide a summary of the answer with references to the next agent. " +
    "If you can't get the answer from Wolfram Alpha, return not found instead.",
  tools: {
    wolframAlphaTool: new WolframAlphaTool({
      appid: process.env.WOLFRAM_ALPHA_APP_ID!,
    }),
  },
});
`,
  DuckDuckGo: `const searchAgent = context.agents.agent({
  model,
  name: "searchAgent",
  maxSteps: 7,
  background:
    "You are an agent that can search the web using DuckDuckGo and scrape content " +
    "from a webpage. You must provide the user with a summary of " +
    "the answer with references to the sources of information you used. If you can't " +
    "find the answer, return not found instead.",
  tools: {
    searchWeb: new DuckDuckGoSearch({ maxResults: 3 }),
    browseWeb: tool({
      description: "Get the content of a webpage.",
      parameters: z.object({
        url: z
          .string()
          .describe(
            "Valid URL including protocol of the webpage you want to scrape content from."
          ),
      }),
      execute: async ({ url }) => {
        const html = await fetch(url).then((res) => res.text());

        const $ = cheerio.load(html);

        const selectorsToRemove = [
          "script",
          "style",
          "header",
          "footer",
          "nav",
          "iframe",
          "noscript",
          "svg",
          '[role="banner"]',
          '[role="navigation"]',
          '[role="complementary"]',
          ".ad",
          ".advertisement",
          ".social-share",
          "aside",
          ".sidebar",
          "#sidebar",
          ".comments",
          "#comments",
        ];

        selectorsToRemove.forEach((selector) => {
          $(selector).remove();
        });

        let $content = $('main, article, [role="main"]');

        if (!$content.length) {
          $content = $("body");
        }

        let content = $content.text();

        content = content.replace(/\s+/g, " ").replace(/\n\s*/g, "\n").trim();
        return content;
      },
    }),
  },
});
`,
  "Cross Reference": `const crossReferenceTask = context.agents.task({
  model,
  prompt:
    "You are an agent that takes input from other agents with access to different " +
    "sources of information, and provide a summary of the answer with references. " +
    "You must provide the user with an answer to their question with references to " +
    "the sources of information you used. Question: " + input
  agents: [wikipediaAgent, wolframAlphaAgent, searchAgent],
  maxSteps: 3,
});

const { text } = await crossReferenceTask.run();
`,
};
