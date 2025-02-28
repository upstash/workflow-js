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
  Exa: `const searchAgent = context.agents.agent({
      model,
      name: 'searchAgent',
      maxSteps: 7,
      background:
        'You are an agent that can search the web using Exa. You must provide ' +
        'the user with a summary of the answer with references to the sources ' +
        "of information you used. If you can't find the answer, return not found " +
        'instead. Include one or more links to the web page(s) you used as a ' +
        'reference if you can.',
      tools: {
        searchWeb: new ExaSearchResults({
          client,
          searchArgs: {
            numResults: 3,
            type: "keyword",
          },
        }),
      }
    });`,
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
