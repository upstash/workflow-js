[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fworkflow-js%2Ftree%2Fmain%2Fexamples%2Fastro&env=QSTASH_TOKEN&envDescription=You%20can%20access%20this%20variable%20from%20Upstash%20Console%2C%20under%20QStash%20page.%20&project-name=workflow-astro&repository-name=workflow-astro&demo-title=Upstash%20Workflow%20Example&demo-description=A%20Astro%20application%20utilizing%20Upstash%20Workflows)

# Upstash Workflow Astro Example

This is an example of how to use Upstash Workflow with Astro. You can learn more in [Upstash Workflow quickstart documentation](https://upstash.com/docs/workflow/quickstarts/platforms).


## Development

1. Install the dependencies

```bash
npm install
```

2. [Start the QStash development server](https://upstash.com/docs/workflow/howto/local-development):

```bash
npx @upstash/qstash-cli dev
```

3. Once you run the development server, you will see `QSTASH_URL` and `QSTASH_TOKEN` environment variables for the local development server. Add these to the `.env` file:

```bash
QSTASH_URL="***"
QSTASH_TOKEN="***"
```

When you are deploying your app to production, you don't need to set `QSTASH_URL`. You should only set the `QSTASH_TOKEN` environment variable to the token you get from [Upstash Console](https://console.upstash.com/qstash).

4. Run your app:

```bash
npm run dev
```

5. Send a `POST` request to the endpoint.

```bash
curl -X POST "http://localhost:3001/api/demo-workflow" -d '{"url": "test.com"}'
```