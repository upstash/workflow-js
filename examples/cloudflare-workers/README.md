# Upstash Workflow Cloudflare Workers Example

This is an example of how to use Upstash Workflow with Cloudflare Workers. You can learn more in [Workflow documentation for Cloudflare Workers](https://upstash.com/docs/qstash/workflow/quickstarts/cloudflare-workers).

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/upstash/qstash-workflow-example-cloudflare-workers) <br/>
**Note:** After deploying with the button above, you need to set the environment variables `QSTASH_URL` and `QSTASH_TOKEN`.

## Development

1. Install the dependencies

```bash
npm install
```

2. [Start the QStash development server](https://upstash.com/docs/workflow/howto/local-development):

```bash
npx @upstash/qstash-cli dev
```

3. Once you run the development server, you will see `QSTASH_URL` and `QSTASH_TOKEN` environment variables for the local development server. Add these to the `.dev.vars` file:

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
curl -X POST "http://localhost:3001" -d '{"text": "hello world!"}'
```

## Deployment

You can use wrangler to deploy the project to Cloudflare Workers.

```bash
npm run deploy
```

Then, go to cloudflare dashboard and find your project. Add the
`QSTASH_TOKEN` environment variable and re-deploy the project.

Once the project is re-deployed, you can send a curl request
like the one above (after replacing the localhost with the
deployment URL).
