# Upstash Workflow TanStack Start Example

This is an example of how to use Upstash Workflow in a TanStack Start project. You can learn more in [Getting Started with Upstash Workflow](https://upstash.com/docs/workflow/getstarted).

## Workflow Routes

This project includes two workflow endpoints that demonstrate different workflow patterns:

### 1. Single Workflow (`/demo/api/single-workflow`)

**Location**: `src/routes/demo/api/single-workflow.ts`

A simple workflow that processes input through two sequential steps. Each step transforms the input and logs the results.

**Features**:
- Sequential step execution
- Input transformation at each step
- Console logging for debugging

### 2. Multi-Workflow Handler (`/demo/api/serve-many/$workflowName`)

**Location**: `src/routes/demo/api/serve-many/$workflowName.ts`

A more advanced setup that hosts multiple workflows and demonstrates workflow invocation patterns.

**Features**:
- Multiple workflows in a single handler
- Workflow-to-workflow invocation
- Dynamic workflow selection via URL parameter
- Custom retry configuration

**Available workflows**:
- `workflowOne`: Invokes `workflowTwo` and processes the results
- `workflowTwo`: A standalone workflow that returns a result

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

The development server will start on port 3001.

## Testing the Workflows

### Single Workflow

Send a POST request to the single workflow endpoint:

```bash
curl -X POST http://localhost:3001/demo/api/single-workflow \
    -H "Content-Type: application/json" \
    -d '"Hello from single workflow!"'
```

**Expected behavior**:
1. The workflow receives the input string
2. Step 1 processes and logs the input
3. Step 2 processes the result from step 1 and logs it
4. Both steps' outputs are visible in the console

### Multi-Workflow Handler

**Test workflowOne** (which invokes workflowTwo):

```bash
curl -X POST http://localhost:3001/demo/api/serve-many/workflowOne \
    -H "Content-Type: application/json" \
    -d '{"body": "Hello from workflow one!"}'
```

**Test workflowTwo** directly:

```bash
curl -X POST http://localhost:3001/demo/api/serve-many/workflowTwo \
    -H "Content-Type: application/json" \
    -d '"Hello from workflow two!"'
```

**Expected behavior for workflowOne**:
1. Logs "workflow one says hi"
2. Invokes workflowTwo with the provided input
3. Logs the invocation results (body, cancellation, and failure status)
4. Logs "workflow one says bye"

**Expected behavior for workflowTwo**:
1. Logs "workflow two says hi"
2. Logs "workflow two says bye"
3. Returns "workflow two done"

## Project Structure

```
src/
├── routes/
│   └── demo/
│       └── api/
│           ├── single-workflow.ts          # Simple sequential workflow
│           └── serve-many/
│               └── $workflowName.ts        # Multi-workflow handler
└── ...
```

## Notes

- **Production Deployment**: Only set `QSTASH_TOKEN` in production; `QSTASH_URL` is not needed

# Learn More

- [TanStack Start Documentation](https://tanstack.com/start)
- [Upstash Workflow Documentation](https://upstash.com/docs/workflow)
- [QStash Documentation](https://upstash.com/docs/qstash)
- [TanStack Documentation](https://tanstack.com)
