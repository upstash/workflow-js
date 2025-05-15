# Upstash Workflow with Nextjs 12 Example

This example is for testing the compatibility of Upstash Workflow with older versions of Nextjs and also older Node versions. Our CI will use this example for testing Workflow with Node 18.

## Development

1. Install the dependencies

```bash
npm install
```

2. [Start the QStash development server](https://upstash.com/docs/workflow/howto/local-development):

```bash
npx @upstash/qstash-cli dev
```

3. Once you run the development server, you will see `QSTASH_URL` and `QSTASH_TOKEN` environment variables for the local development server. Add these to the `.env.local` file:

```bash
QSTASH_URL="***"
QSTASH_TOKEN="***"
```

When you are deploying your app to production, you don't need to set `QSTASH_URL`. You should only set the `QSTASH_TOKEN` environment variable to the token you get from [Upstash Console](https://console.upstash.com/qstash).

4. Run your app:

```bash
npm run dev
```

5. Send a `POST` request to the `/api/path` endpoint. In your requesets, you should use `text/plain` header:

```bash
curl -X POST "http://localhost:3001/api/workflow" \
     -H "Content-type: text/plain" \
     -d "my-payload"
```

## Deploying the Project at Vercel

To deploy the project, you can simply use the `Deploy with Vercel` button at the top of this README. If you want to edit the project and deploy it, you can read the rest of this section.

To deploy the project at vercel and try the endpoints, you should start with setting up the project by running:

```
vercel
```