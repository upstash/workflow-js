[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fworkflow-js%2Ftree%2Fmain%2Fexamples%2Fagents-researcher&env=UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN,QSTASH_TOKEN,OPENAI_API_KEY,WOLFRAM_ALPHA_APP_ID,EXASEARCH_API_KEY&project-name=upstash-workflow-agents-researcher&repository-name=upstash-workflow-agents-researcher&demo-title=Cross%20Reference%20Agent&demo-description=This%20is%20a%20simple%20example%20to%20demonstrate%20how%20to%20use%20Upstash%20Workflow%20Agents%20to%20cross-reference%20information%20from%20different%20sources.&demo-url=https%3A%2F%2Fagents-researcher.vercel.app%2F)

## Deploying the Project at Vercel

To deploy the project, you can simply use the `Deploy with Vercel` button at the top of this README. If you want to edit the project and deploy it, you can read the rest of this section.

To deploy the project at vercel and try the endpoints, you should start with setting up the project by running:

```
vercel
```

### Setting up the Environment Variables

1. `QSTASH_TOKEN`

Next, you shoud go to vercel.com, find your project and add `QSTASH_TOKEN`, to the project as environment variables. You can find this env variables from the [Upstash Console](https://console.upstash.com/qstash). To learn more about other QStash env variables and their use in the context of Upstash Workflow, you can read [the Secure your Endpoint in our documentation](https://upstash.com/docs/qstash/workflow/howto/security#using-qstashs-built-in-request-verification-recommended).

2. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

You can find these env variables from the [Upstash Console](https://console.upstash.com/redis).

3. `OPENAI_API_KEY`

You can get your API key from the [OpenAI Platform](https://platform.openai.com/api-keys).

4. `WOLFRAM_ALPHA_APP_ID`

You can get your App ID from the [Wolfram Alpha Developer Portal](https://developer.wolframalpha.com).

5. `EXASEARCH_API_KEY`

You can get your API key from the [Exa Dashboard](https://dashboard.exa.ai/api-keys).

### Deploying the Project

Once you add the env variables, you can deploy the project with:

```
vercel --prod
```

Note that the project won't work in preview. It should be deployed to production like above. This is because preview requires authentication.

Once you have the app deployed, you can go to the deployment and call the endpoints using the form on the page.

You can observe the logs at [Upstash console under the Worfklow tab](https://console.upstash.com/qstash?tab=workflow) or vercel.com to see your workflow operate.

## Local Development

For local development setup, refer to the [Local Development section in our documentation](https://upstash.com/docs/qstash/workflow/howto/local-development). Also set up the environment variables in a `.env` file as described in the previous section.