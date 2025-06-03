# Upstash Workflow & Fastify Example

This is an example of how to use [Upstash Workflow](https://upstash.com/docs/workflow/getstarted) with a Fastify server using TypeScript and ES modules.

## Getting Started

### 1. Install the dependencies

```bash
bun install
```

### 2. [Start the QStash development server](https://upstash.com/docs/workflow/howto/local-development):

```bash
npx @upstash/qstash-cli dev
```

### 3. Once you run the development server, you will see `QSTASH_URL` and `QSTASH_TOKEN` environment variables for the local development server. Add these to the `.env` file:

```bash
QSTASH_URL="***"
QSTASH_TOKEN="***"
```

When you are deploying your app to production, you don't need to set `QSTASH_URL`. You should only set the `QSTASH_TOKEN` environment variable to the token you get from [Upstash Console](https://console.upstash.com/qstash).

### 4. Run your app:

```bash
bun start
```

For production builds:

```bash
bun run build
bun run start:prod
```

### 5. Send a `POST` request to the workflow endpoint.

```bash
curl -X POST http://localhost:3001/workflow -d '{"hello": "world"}' -H "content-type:application/json"
```

## Project Structure

- `src/index.ts`: Entry point for the application
- `src/server.ts`: Fastify server configuration and workflow implementation
- `tsconfig.json`: TypeScript configuration
- `package.json`: Project dependencies and scripts

## Scripts

- `bun start`: Start the development server using Bun
- `bun run build`: Build the TypeScript files
