# Realtime Chat with Durable LLM Streams

An example repository demonstrating how to use **Upstash Realtime** with the **AI SDK** and **Upstash Workflows** to create a durable chat application with human-in-the-loop functionality.

## 🚀 Features

- **Durable AI Streams**: Chat conversations persist even if the browser is refreshed or closed
- **Real-time Communication**: Powered by Upstash Realtime for seamless streaming
- **Human-in-the-Loop**: Tool execution requires user approval before running
- **Modern UI**: Clean, responsive interface with dark theme
- **Weather Tool**: Example tool that demonstrates approval workflow
- **Chat History**: Persistent conversation history stored in Redis
- **Streaming Animation**: Smooth text streaming with markdown rendering

## 🏗️ Architecture

This application combines several powerful technologies:

- **[Upstash Realtime](https://upstash.com/docs/realtime/overall/quickstart)**: Real-time event streaming
- **[Vercel AI SDK](https://ai-sdk.dev/docs/introduction)**: Modern AI integration with React
- **[Upstash Workflows](https://upstash.com/docs/workflow/getstarted)**: Durable function execution
- **[Upstash Redis](https://upstash.com/docs/redis/overall/getstarted)**: Data persistence

## 📋 Prerequisites

Before running this application, you'll need:

1. **Node.js** (v18 or later)
2. **Bun** package manager (recommended) or npm
3. **Upstash Account**: Sign up at [upstash.com](https://console.upstash.com/)
4. **OpenAI API Key**: Get one from [platform.openai.com](https://platform.openai.com)

## 🛠️ Setup

Start by cloning the repository and going to the example app directory:

```bash
git clone git@github.com:upstash/workflow-js.git
cd workflow-js/examples/upstash-realtime-ai-sdk
```

### 1. Clone and Install Dependencies

```bash
bun install
```

### 2. Environment Configuration

Create a `.env.local` file in the root directory with the following variables:

```env
# Upstash Redis Configuration
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Qstash/Workflow Configuration
QSTASH_TOKEN=
```

### 3. Upstash Setup

1. **Create a Redis Database**:

   - Go to [Upstash Console](https://console.upstash.com)
   - Create a new Redis database
   - Copy the REST URL and token

2. **Establish a QStash Server**:
   - For dev environment, you should run `npx @upstash/qstash-cli@latest dev` in the terminal to start QStash local dev server.
   - Set the QSTASH_TOKEN in your `.env.local` file (set QSTASH_URL too if you are using local dev server)

### 4. Run the Application

```bash
bun dev
```

## 🔧 How It Works

### Durable Streams

The application implements durable AI streams that survive browser refreshes and network interruptions:

1. **Message Persistence**: All chat messages are stored in Redis with unique IDs
2. **Stream Recovery**: When reconnecting, the app resumes from the last message
3. **Workflow Execution**: AI generation runs in Upstash Workflows for reliability

### Human-in-the-Loop

The weather tool demonstrates the approval workflow:

1. User asks about weather
2. AI requests permission to execute the weather tool
3. User can approve or reject the tool execution
4. Only approved tools actually execute

### Real-time Communication

- Upstash Realtime allows us to stream the processes going on with the workflows on the server side
to client in realtime.
- In this example, we use realtime to stream each chunk created by aisdk to the client side,
integrated with useChat hook.

## 📁 Project Structure

```
src/
├── app/
│   ├── api/chat/route.ts      # Chat API endpoint with workflow
│   ├── layout.tsx             # Root layout component
│   └── page.tsx               # Main page component
├── components/
│   ├── ai-elements/           # AI-specific UI components
│   ├── chat.tsx               # Main chat component
│   ├── providers.tsx          # React providers setup
│   └── ui/                    # Reusable UI components
└── lib/
    ├── realtime.ts            # Upstash Realtime configuration
    ├── redis.ts               # Redis client setup
    └── utils.ts               # Utility functions
```

## 🎯 Key Components

### Chat Component (`src/components/chat.tsx`)

- Handles chat state management
- Implements durable stream recovery
- Manages tool approval workflows
- Provides real-time UI updates

### API Route (`src/app/api/chat/route.ts`)

- Implements Upstash Workflow for AI generation
- Handles stream reconnection
- Manages tool execution with approval
- Stores conversation history

### Realtime Setup (`src/lib/realtime.ts`)

- Configures Upstash Realtime client
- Defines event schemas

## 📚 Learn More

- [Upstash Realtime Documentation](https://upstash.com/docs/realtime/overall/quickstart)
- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs/introduction)
- [Upstash Workflows Documentation](https://upstash.com/docs/workflow/getstarted)

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
