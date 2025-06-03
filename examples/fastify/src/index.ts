// src/index.ts
import server from './server.js';

// Run the server!
const start = async (): Promise<void> => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });
    const address = server.server.address();
    const port = typeof address === 'string' ? address : address?.port;
    server.log.info(`Server is running on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    console.log(err);
    console.error('Server failed to start');
    process.exit(1);
  }
};

start();
