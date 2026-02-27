import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type { DataService } from './services/data-service.js';
import type { OrchestratorClient, SessionInfo } from './services/orchestrator-client.js';
import type { SessionPipeline } from './services/session-pipeline.js';
import { type FileWatcher, type FileChangeEvent } from './services/file-watcher.js';
import { boardRoutes } from './routes/board.js';
import { epicRoutes } from './routes/epics.js';
import { ticketRoutes } from './routes/tickets.js';
import { stageRoutes } from './routes/stages.js';
import { graphRoutes } from './routes/graph.js';
import { sessionRoutes } from './routes/sessions.js';
import { repoRoutes } from './routes/repos.js';
import { eventRoutes, broadcastEvent } from './routes/events.js';
import { interactionRoutes } from './routes/interaction.js';
import { orchestratorRoutes, computeWaitingType } from './routes/orchestrator.js';

interface SessionStatusSSE {
  stageId: string;
  sessionId?: string;
  status: 'starting' | 'active' | 'ended';
  waitingType: 'user_input' | 'permission' | null;
  spawnedAt?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    dataService: DataService | null;
    claudeProjectsDir: string;
    orchestratorClient: OrchestratorClient | null;
    sessionPipeline: SessionPipeline | null;
    fileWatcher: FileWatcher | null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  logger?: boolean;
  vitePort?: number;
  isDev?: boolean;
  dataService?: DataService;
  claudeProjectsDir?: string;
  orchestratorClient?: OrchestratorClient;
  sessionPipeline?: SessionPipeline;
  fileWatcher?: FileWatcher;
}

export async function createServer(
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const {
    logger = true,
    vitePort = 3101,
    isDev = process.env.NODE_ENV !== 'production',
  } = options;

  const app = Fastify({ logger });

  // CORS — allow localhost origins
  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)
      ) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  // DataService decoration — available to all route plugins via app.dataService
  const dataService = options.dataService ?? null;
  app.decorate('dataService', dataService);

  // Claude projects directory — used by session routes to find .jsonl files
  const claudeProjectsDir =
    options.claudeProjectsDir ?? join(os.homedir(), '.claude', 'projects');
  app.decorate('claudeProjectsDir', claudeProjectsDir);

  // OrchestratorClient decoration — WebSocket connection to orchestrator
  const orchestratorClient = options.orchestratorClient ?? null;
  app.decorate('orchestratorClient', orchestratorClient);
  if (orchestratorClient) {
    app.addHook('onReady', async () => orchestratorClient.connect());
    app.addHook('onClose', async () => orchestratorClient.disconnect());
  }

  // SessionPipeline decoration — JSONL session parsing + caching
  const sessionPipeline = options.sessionPipeline ?? null;
  app.decorate('sessionPipeline', sessionPipeline);

  // FileWatcher decoration — available to route plugins (e.g. SSE) via app.fileWatcher
  app.decorate('fileWatcher', options.fileWatcher ?? null);

  // FileWatcher — watches Claude project directories for JSONL changes
  if (options.fileWatcher) {
    const fw = options.fileWatcher;
    app.addHook('onReady', async () => fw.start());
    app.addHook('onClose', async () => fw.stop());

    // Invalidate cache on file changes
    fw.on('file-change', (event: FileChangeEvent) => {
      sessionPipeline?.invalidateSession(
        join(claudeProjectsDir, event.projectId),
        event.sessionId,
      );
      // Push SSE event to connected browsers
      broadcastEvent('session-update', {
        projectId: event.projectId,
        sessionId: event.sessionId,
        isSubagent: event.isSubagent,
      });
    });
  }

  // OrchestratorClient → SSE broadcast for session lifecycle events
  if (orchestratorClient) {
    const oc = orchestratorClient;

    // Map requestId → stageId so approval-cancelled can resolve the stageId
    const requestStageMap = new Map<string, string>();

    oc.on('session-registered', (entry: SessionInfo) => {
      broadcastEvent('stage-transition', {
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        type: 'session_started',
        timestamp: entry.spawnedAt,
      });
      const sseEvent: SessionStatusSSE = {
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        status: 'starting',
        waitingType: null,
        spawnedAt: entry.spawnedAt,
      };
      broadcastEvent('session-status', sseEvent);
    });

    oc.on('session-status', (entry: SessionInfo) => {
      broadcastEvent('board-update', {
        type: 'session_status',
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        status: entry.status,
      });
      const pending = oc.getPendingForStage(entry.stageId);
      const waitingType = computeWaitingType(pending);
      const sseEvent: SessionStatusSSE = {
        stageId: entry.stageId,
        status: entry.status,
        waitingType,
      };
      broadcastEvent('session-status', sseEvent);
    });

    oc.on('session-ended', (entry: SessionInfo) => {
      broadcastEvent('stage-transition', {
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        type: 'session_ended',
        timestamp: entry.lastActivity,
      });
      broadcastEvent('board-update', {
        type: 'session_ended',
        stageId: entry.stageId,
      });
      const sseEvent: SessionStatusSSE = {
        stageId: entry.stageId,
        status: 'ended',
        waitingType: null,
      };
      broadcastEvent('session-status', sseEvent);
      // Clean up requestStageMap entries for this stage
      for (const [reqId, sid] of requestStageMap) {
        if (sid === entry.stageId) requestStageMap.delete(reqId);
      }
    });

    oc.on('approval-requested', (data) => {
      broadcastEvent('approval-requested', data);
      requestStageMap.set(data.requestId, data.stageId);
      const sseEvent: SessionStatusSSE = {
        stageId: data.stageId,
        status: 'active',
        waitingType: 'permission',
      };
      broadcastEvent('session-status', sseEvent);
    });

    oc.on('question-requested', (data) => {
      broadcastEvent('question-requested', data);
      requestStageMap.set(data.requestId, data.stageId);
      const sseEvent: SessionStatusSSE = {
        stageId: data.stageId,
        status: 'active',
        waitingType: 'user_input',
      };
      broadcastEvent('session-status', sseEvent);
    });

    oc.on('approval-cancelled', (data) => {
      broadcastEvent('approval-cancelled', data);
      // Resolve stageId from the local map and recompute waitingType
      const stageId = requestStageMap.get(data.requestId);
      requestStageMap.delete(data.requestId);
      if (stageId) {
        const pending = oc.getPendingForStage(stageId);
        const waitingType = computeWaitingType(pending);
        const sseEvent: SessionStatusSSE = {
          stageId,
          status: 'active',
          waitingType,
        };
        broadcastEvent('session-status', sseEvent);
      }
    });

    oc.on('message-queued', (data) => {
      broadcastEvent('message-queued', data);
    });

    oc.on('message-sent', (data) => {
      broadcastEvent('message-sent', data);
    });
  }

  // --- API routes ---
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  await app.register(boardRoutes);
  await app.register(epicRoutes);
  await app.register(ticketRoutes);
  await app.register(stageRoutes);
  await app.register(graphRoutes);
  await app.register(sessionRoutes);
  await app.register(repoRoutes);
  await app.register(eventRoutes);

  // Orchestrator routes — session status endpoint
  await app.register(orchestratorRoutes);

  // Interaction routes — requires orchestratorClient
  if (orchestratorClient) {
    await app.register(interactionRoutes, { orchestratorClient });
  }

  // --- Static serving / dev proxy ---
  if (!isDev) {
    // Production: serve built client assets
    const clientDir = join(__dirname, '../client');
    let indexHtml: string | null = null;

    const indexPath = join(clientDir, 'index.html');
    if (existsSync(clientDir) && existsSync(indexPath)) {
      indexHtml = readFileSync(indexPath, 'utf-8');

      await app.register(fastifyStatic, {
        root: clientDir,
        prefix: '/',
        wildcard: false,
      });
    }

    // SPA fallback + API 404 — always registered in production
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      if (indexHtml) {
        return reply.type('text/html').send(indexHtml);
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  } else {
    // Development: proxy non-API requests to Vite dev server
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      try {
        const viteUrl = `http://localhost:${vitePort}${request.url}`;
        const response = await fetch(viteUrl, {
          method: request.method,
          headers: { host: `localhost:${vitePort}` },
        });

        reply.status(response.status);
        const contentType = response.headers.get('content-type');
        if (contentType) {
          reply.header('content-type', contentType);
        }

        const body = Buffer.from(await response.arrayBuffer());
        return reply.send(body);
      } catch {
        return reply
          .status(502)
          .send({ error: 'Vite dev server not available' });
      }
    });
  }

  return app;
}
