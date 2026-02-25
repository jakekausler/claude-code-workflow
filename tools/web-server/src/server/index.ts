import { createServer } from './app.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || '0.0.0.0';

const app = await createServer();

await app.listen({ port, host });

// Graceful shutdown
function shutdown(): void {
  app.close().then(
    () => process.exit(0),
    (err) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    },
  );
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
