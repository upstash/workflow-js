# Upstash Workflow Cloudflare Workers Example (with Hono)

This is an example of how to use Upstash Workflow with Cloudflare Workers with Hono router. You can learn more in [Workflow documentation for Hono](https://upstash.com/docs/qstash/workflow/quickstarts/hono).

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/upstash/qstash-workflow-example-cloudflare-workers-hono) <br/>
**Note:** After deploying with the button above, you need to set the environment variables `QSTASH_URL` and `QSTASH_TOKEN`.

## Development

> [!TIP]
> You can use [the `bootstrap.sh` script](https://github.com/upstash/workflow-js/tree/main/examples) to run this example with a local tunnel.
>
> Simply set the environment variables as explained below and run the following command in the `workflow-js/examples` directory:
>
> ```
> bash bootstrap.sh cloudflare-workers-hono
> ```

1. Install the dependencies

```bash
npm install
```

2. Get the credentials from the [Upstash Console](https://console.upstash.com/qstash) and add them to the `.dev.vars` file.

```bash
QSTASH_URL=
QSTASH_TOKEN=
```

3. Open a local tunnel to port of the development server

```bash
ngrok http 3001
```

Also, set the `UPSTASH_WORKLFOW_URL` environment variable to the public url provided by ngrok.

4. Run the development server

```bash
npm run dev
```

5. Send a `POST` request to the `/workflow` endpoint.

```bash
curl -X POST "http://localhost:3001/workflow" -d '{"text": "hello world!"}'
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
