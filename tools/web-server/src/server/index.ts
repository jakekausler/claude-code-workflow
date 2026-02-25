import { createServer } from './app.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { DataService } from './services/data-service.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || '0.0.0.0';
const dbPath = process.env.KANBAN_DB_PATH;

const db = new KanbanDatabase(dbPath);
const dataService = new DataService({ db });

const app = await createServer({ dataService });

await app.listen({ port, host });

// Graceful shutdown
function shutdown(): void {
  app.close().then(
    () => {
      dataService.close();
      process.exit(0);
    },
    (err) => {
      console.error('Error during shutdown:', err);
      dataService.close();
      process.exit(1);
    },
  );
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
