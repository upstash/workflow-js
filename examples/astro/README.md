[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fworkflow-js%2Ftree%2Fmain%2Fexamples%2Fastro&env=QSTASH_TOKEN&envDescription=You%20can%20access%20this%20variable%20from%20Upstash%20Console%2C%20under%20QStash%20page.%20&project-name=workflow-astro&repository-name=workflow-astro&demo-title=Upstash%20Workflow%20Example&demo-description=A%20Astro%20application%20utilizing%20Upstash%20Workflows)

# Upstash Workflow Astro Example

This is an example of how to use Upstash Workflow with Astro. You can learn more in [Upstash Workflow quickstart documentation](https://upstash.com/docs/workflow/quickstarts/platforms).


## Development

> [!TIP]
> You can use [the `bootstrap.sh` script](https://github.com/upstash/workflow-js/tree/main/examples) to run this example with a local tunnel.
>
> Simply set the environment variables as explained below and run the following command in the `workflow-js/examples` directory:
>
> ```
> bash bootstrap.sh astro
> ```

1. Install the dependencies

```bash
npm install
```

1. Get the credentials from the [Upstash Console](https://console.upstash.com/qstash) and add them to the `.env` file.

```bash
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

5. Send a `POST` request to the endpoint.

```bash
curl -X POST "http://localhost:3001/api/demo-workflow" -d '{"url": "test.com"}'
```