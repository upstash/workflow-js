import { openai } from "@ai-sdk/openai";
import { realtime } from "@/lib/realtime";
import { redis } from "@/lib/redis";
import { serve } from "@upstash/workflow/nextjs";
import { convertToModelMessages, streamText, tool, UIMessage } from "ai";
import { z } from "zod";

export const GET = async (req: Request) => {
  const { searchParams } = new URL(req.url);

  const id = searchParams.get("id");
  if (!id) return new Response("ID is required.");

  const channel = realtime.channel(id);

  const stream = new ReadableStream({
    async start(controller) {
      await channel.history().on("ai.chunk", (chunk) => {
        controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        if (chunk.type === "finish") controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
};

export const { POST } = serve(async (workflow) => {
  const { id, messages } = workflow.requestPayload as {
    id: string;
    messages: UIMessage[];
  };

  await workflow.run("ai-generation", async () => {
    const result = streamText({
      model: openai("gpt-4o"),
      tools: {
        weather,
      },
      system:
        "Use markdown and headings 1-3 to nicely format your response. Use a few emojis. " +
        "When a tool execution is not approved by the user, do not retry it.",

      messages: convertToModelMessages(messages),
    });

    const stream = result.toUIMessageStream({
      generateMessageId: () => crypto.randomUUID(),
      originalMessages: messages,
      onFinish: async ({ messages }) => {
        await redis.set(`history:${id}`, messages);
      },
    });

    const channel = realtime.channel(messages[messages.length - 1].id);
    for await (const chunk of stream) {
      await channel.emit("ai.chunk", chunk);
    }
  });
});

export const weather = tool({
  description: "Get the current weather for a specific location.",
  execute: async ({ location }: { location: string }) => {
    // Mock weather data
    const weatherData = {
      "New York": { temperature: 72, condition: "Sunny", humidity: 65 },
      London: { temperature: 55, condition: "Cloudy", humidity: 80 },
      Tokyo: { temperature: 68, condition: "Partly Cloudy", humidity: 70 },
      Paris: { temperature: 62, condition: "Rainy", humidity: 85 },
      Sydney: { temperature: 75, condition: "Sunny", humidity: 60 },
    };

    const data = weatherData[location as keyof typeof weatherData] || {
      temperature: Math.floor(Math.random() * 30) + 50,
      condition: "Unknown",
      humidity: Math.floor(Math.random() * 40) + 50,
    };

    return `The weather in ${location} is ${data.temperature}°F, ${data.condition} with ${data.humidity}% humidity.`;
  },
  inputSchema: z.object({
    location: z
      .string()
      .min(1)
      .max(100)
      .describe("The city or location to get weather for"),
  }),
  needsApproval: true,
});
