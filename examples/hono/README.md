# Upstash Workflow Hono Example

This is an example of how to use Upstash Workflow in a Hono project. You can learn more in [Workflow documentation for Hono](https://upstash.com/docs/qstash/workflow/quickstarts/hono).

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

5. Send a `POST` request to the `/workflow` endpoint.

```bash
curl -X POST "http://localhost:3001/workflow" -d '{"text": "hello world!"}'
```
