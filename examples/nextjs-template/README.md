[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fworkflow-js%2Ftree%2Fmain%2Fexamples%2Fnextjs-template&env=QSTASH_TOKEN,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN&envDescription=You%20can%20access%20the%20QSTASH_TOKEN%20env%20variable%20from%20Upstash%20Console%2C%20under%20QStash%20page.%20You%20can%20get%20Redis%20keys%20after%20creating%20a%20Redis%20database%20from%20Upstash%20Console.&project-name=upstash-workflow-template&repository-name=upstash-workflow-demo&demo-title=Upstash%20Workflow%20NextJS%20Template&demo-url=https%3A%2F%2Fworkflow-nextjs-template.vercel.app&demo-image=https%3A%2F%2Fworkflow-nextjs-template.app%2Flanding.png)

# Upstash Workflow NextJS Template

This project is a simple template for Upstash Workflow usage with NextJS.

It showcases how you can call a long running endpoint with Upstash Workflow and display it's results in the client.

See the demo at https://workflow-nextjs-template.vercel.app.

For more information about Upstash Workflow, you can refer [to the Upstash Workflow documentation](https://upstash.com/docs/qstash/workflow/getstarted).

## Deploying the Project at Vercel

To deploy the project, you can simply use the `Deploy with Vercel` button at the top of this README. If you want to edit the project and deploy it, you can read the rest of this section.

To deploy the project at vercel and try the endpoints, you should start with setting up the project by running:

```
vercel
```

Next, you shoud go to vercel.com, find your project and add `QSTASH_TOKEN`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, to the project as environment variables. You can find these environment variables from the [Upstash Console](https://console.upstash.com). To learn more about other environment variables and their use in the context of Upstash Workflow, you can read the [Secure your Endpoint](https://upstash.com/docs/qstash/workflow/howto/security#using-qstashs-built-in-request-verification-recommended) page in our documentation.

Once you add the environment variables, you can deploy the project with:

```
vercel --prod
```

Note that the project won't work in preview. It should be deployed to production like above. This is because vercel previews require authentication. You can read more about the fix the [troubleshooting page](https://upstash.com/docs/workflow/troubleshooting/vercel).

Once you have the app deployed, you can go to the deployment and call the endpoints using the form on the page.

You can observe the logs at [Upstash console under the Worfklow tab](https://console.upstash.com/qstash?tab=workflow) or [vercel.com](https://vercel.com) to see your workflow operate.

## Local Development

For local development setup, refer to the [Local Development section in our documentation](https://upstash.com/docs/qstash/workflow/howto/local-development).

You also have to set the `VERCEL_URL` to your local server url like `http://localhost:3000`. This is required for the app to call the `/api/mock-api` endpoint in the `/api/regular` route.

Here is the format of the `.env` file for local development:

```bash
QSTASH_TOKEN=<YOUR_QSTASH_TOKEN>
UPSTASH_REDIS_REST_URL=<YOUR_REDIS_URL>
UPSTASH_REDIS_REST_TOKEN=<YOUR_REDIS_TOKEN>

# For local development
UPSTASH_WORKFLOW_URL=<YOUR_LOCAL_TUNNEL_URL>
VERCEL_URL=http://localhost:3000
```

## Endpoints

- `/api/mock-api`: A mock endpoint that takes 5 seconds to respond and returns `{"foo": "bar"}`. This is used to mock a long running external API.
- `/api/regular`: The regular way of calling the mock endpoint. This will take 5 seconds to respond.
- `/api/workflow`: The workflow way of calling the mock endpoint. This will respond instantly and the workflow will call the mock endpoint in the background. When it resolves, the result will be written to the redis database.
- `/api/check-workflow`: The endpoint to check the redis database for the result of the workflow. This will return the result if it's available.

The frontend will call the `/api/workflow` endpoint and then poll the `/api/check-workflow` endpoint to get the result.
