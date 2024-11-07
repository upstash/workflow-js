# Upstash Workflow Express Example

This is an example of how to use Upstash Workflow in a Express.js project. You can learn more in [Getting Started with Upstash Workflow](https://upstash.com/docs/workflow/getstarted).

## Development

> [!TIP]
> You can use [the `bootstrap.sh` script](https://github.com/upstash/qstash-js/tree/main/examples/workflow) to run this example with a local tunnel.
>
> Simply set the environment variables as explained below and run the following command in the `qstash-js/examples/workflow` directory:
>
> ```
> bash bootstrap.sh express
> ```

1. Install the dependencies

```bash
npm install
```

2. Get the credentials from the [Upstash Console](https://console.upstash.com/qstash) and add them to the `.env` file.

```bash
QSTASH_TOKEN=

UPSTASH_WORKFLOW_URL=
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

**NOTE**: Workflow on Express.js only works with `Content-Type: application/json` header.

```bash
curl -X POST http://localhost:3001/workflow \
    -H "Content-Type: application/json" \
    -d '{"message": "Hello from the workflow!"}'
```
