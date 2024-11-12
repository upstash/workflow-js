# Upstash Workflow with Nextjs 12 Example

This example is for testing the compatibility of Upstash Workflow with older versions of Nextjs and also older Node versions. Our CI will use this example for testing Workflow with Node 18.

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

2. Get the credentials from the [Upstash Console](https://console.upstash.com/qstash) and add them to the `.env.local` file.

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