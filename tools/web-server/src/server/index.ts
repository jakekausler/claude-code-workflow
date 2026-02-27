import { join } from 'path';
import os from 'os';
import { createServer } from './app.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { DataService } from './services/data-service.js';
import { OrchestratorClient } from './services/orchestrator-client.js';
import { SessionPipeline } from './services/session-pipeline.js';
import { FileWatcher } from './services/file-watcher.js';
import { LocalDeploymentContext } from './deployment/index.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || '0.0.0.0';
const dbPath = process.env.KANBAN_DB_PATH;

const orchestratorWsUrl =
  process.env.ORCHESTRATOR_WS_URL ?? 'ws://localhost:3101';
const orchestratorClient = new OrchestratorClient(orchestratorWsUrl);

const db = new KanbanDatabase(dbPath);
const dataService = new DataService({ db });

// Create deployment context based on DEPLOYMENT_MODE env var
const deploymentContext = process.env.DEPLOYMENT_MODE === 'hosted'
  ? (() => { throw new Error('Hosted mode not yet implemented'); })()
  : new LocalDeploymentContext();

const claudeProjectsDir =
  process.env.CLAUDE_PROJECTS_DIR ?? join(os.homedir(), '.claude', 'projects');
const sessionPipeline = new SessionPipeline();
const fileWatcher = new FileWatcher({
  rootDir: claudeProjectsDir,
  fileSystem: deploymentContext.getFileAccess(),
});

const app = await createServer({
  dataService,
  orchestratorClient,
  claudeProjectsDir,
  sessionPipeline,
  fileWatcher,
  deploymentContext,
});

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
