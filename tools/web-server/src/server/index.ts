import { createServer } from './app.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || 'localhost';

const app = await createServer();

await app.listen({ port, host });

console.log(`Server running at http://${host}:${port}`);

// Graceful shutdown
function shutdown(): void {
  app.close().then(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
