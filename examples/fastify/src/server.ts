// src/server.ts
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyEnv from '@fastify/env';
import { serve } from '@upstash/workflow';

const fastify = Fastify({
  logger: false
});

const schema = {
  type: 'object',
  required: ['QSTASH_URL', 'QSTASH_TOKEN'],
  properties: {
    QSTASH_URL: {
      type: 'string',
    },
    QSTASH_TOKEN: {
      type: 'string',
    }
  }
}

const options = {
  confKey: 'config', // optional, default: 'config'
  schema: schema,
  dotenv: true
}

interface FastifyEnvConfig {
  QSTASH_URL: string;
  QSTASH_TOKEN: string;
}

// Extend FastifyInstance to include the config property
declare module 'fastify' {
  interface FastifyInstance {
    config: FastifyEnvConfig;
  }
}

fastify.register(fastifyEnv, options).after(() => {
  // Register the /upstash route as a regular fastify route
  const { handler } = serve(async (context) => {
    const input = context.requestPayload;
    const result1 = await context.run('step1', async () => {
      const output = someWork(input);
      console.log('step 1 input', input, 'output', output);
      return output;
    });

    await context.run('step2', async () => {
      const output = someWork(result1);
      console.log('step 2 input', result1, 'output', output);
    });
  });

  fastify.route({
    method: ['POST'],
    url: '/workflow',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      // Convert Fastify request to Web Request
      const { url, headers } = request;
      
      // @ts-expect-error getting encrypted property from raw socket
      const encrypted: boolean = request.raw.socket.encrypted;
      
      // Get full URL including protocol and host
      const protocol = request.protocol || (encrypted ? 'https' : 'http');
      const host = headers['host'] as string;
      const fullUrl = `${protocol}://${host}${url}`;

      // Read body as a Buffer
      let body: Buffer | null = null;
      if (request.body) {
        if (Buffer.isBuffer(request.body)) {
          body = request.body;
        } else if (typeof request.body === 'string') {
          body = Buffer.from(request.body);
        } else {
          // Assume JSON
          body = Buffer.from(JSON.stringify(request.body));
        }
      }

      // Construct Web Request
      const webRequest = new Request(fullUrl, {
        method: "POST",
        headers: headers as HeadersInit,
        body
      });

      // Call the handler
      const webResponse = await handler(webRequest);

      // Set status and headers
      reply.code(webResponse.status);

      // Send body
      const responseBody = await webResponse.arrayBuffer();
      reply.send(Buffer.from(responseBody));
    }
  });
});

const someWork = (input: unknown): string => {
  return `processed '${JSON.stringify(input)}'`;
};

export default fastify;
