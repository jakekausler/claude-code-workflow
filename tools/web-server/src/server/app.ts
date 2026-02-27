import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
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
import { buildProcessFromFile, calculateAgentMetrics, detectOngoing } from './services/subagent-resolver.js';
import { parseSessionFile } from './services/session-parser.js';
import type { Process } from './types/jsonl.js';

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

    // Per-session SSE broadcast debouncing (300ms window)
    const sseDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const sseDebounceOffsets = new Map<string, number>();

    // Cache per subagent file: holds the parsed Process and byte offset so we only
    // parse NEW bytes on each file-change event instead of re-parsing the entire file.
    interface CachedSubagent {
      process: Process;
      offset: number;
    }
    const subagentCache = new Map<string, CachedSubagent>();

    // Invalidate cache + incremental parse on file changes
    fw.on('file-change', (event: FileChangeEvent) => {
      // Debounce SSE broadcast per session to coalesce rapid changes
      const key = `${event.projectId}/${event.sessionId}/${event.isSubagent ? 'sub' : 'main'}`;
      const existing = sseDebounceTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      // Track the minimum previousOffset across all events in this debounce window
      // so the incremental parse covers ALL bytes written during the window
      const currentMin = sseDebounceOffsets.get(key);
      if (currentMin === undefined || event.previousOffset < currentMin) {
        sseDebounceOffsets.set(key, event.previousOffset);
      }
      const timer = setTimeout(() => {
        sseDebounceTimers.delete(key);
        const minOffset = sseDebounceOffsets.get(key) ?? 0;
        sseDebounceOffsets.delete(key);
        const fullProjectDir = join(claudeProjectsDir, event.projectId);

        void (async () => {
          try {
            // No pipeline available — can't parse anything
            if (!sessionPipeline) {
              broadcastEvent('session-update', {
                projectId: event.projectId,
                sessionId: event.sessionId,
                type: 'full-refresh',
              });
              return;
            }

            // Subagent file changes: use incremental parsing to avoid
            // re-parsing the entire file on every change.  We cache the
            // Process object and byte offset, parsing only NEW bytes.
            if (event.isSubagent) {
              const cached = subagentCache.get(event.filePath);
              const startOffset = cached?.offset ?? 0;

              // Skip if file hasn't grown since last successful parse.
              if (cached && event.currentSize <= cached.offset) {
                return;
              }

              sessionPipeline.invalidateSession(fullProjectDir, event.sessionId);

              // Extract the agent ID from the file path.
              const agentFilename = event.filePath.split('/').pop() ?? '';
              const agentIdMatch = agentFilename.match(/^agent-(.+)\.jsonl$/);
              const agentId = agentIdMatch ? agentIdMatch[1] : event.sessionId;

              let subagentProcess: Process | null = null;
              try {
                if (cached) {
                  // Incremental: parse only new bytes and merge into cached Process.
                  const { messages: newMessages, bytesRead } = await parseSessionFile(
                    event.filePath,
                    { startOffset },
                  );
                  const newOffset = startOffset + bytesRead;

                  if (newMessages.length === 0) {
                    // No new messages — update offset but skip broadcast.
                    subagentCache.set(event.filePath, { process: cached.process, offset: newOffset });
                    return;
                  }

                  const allMessages = [...cached.process.messages, ...newMessages];
                  const endTime = allMessages[allMessages.length - 1]?.timestamp ?? cached.process.endTime;
                  subagentProcess = {
                    ...cached.process,
                    messages: allMessages,
                    endTime,
                    durationMs: endTime.getTime() - cached.process.startTime.getTime(),
                    metrics: calculateAgentMetrics(allMessages),
                    isOngoing: detectOngoing(allMessages),
                  };

                  subagentCache.set(event.filePath, { process: subagentProcess, offset: newOffset });
                } else {
                  // First time seeing this file — full parse via buildProcessFromFile
                  // which handles filtering (warmup, compact, empty) and extracts parentTaskId.
                  subagentProcess = await buildProcessFromFile(event.filePath, agentId);
                  if (subagentProcess) {
                    subagentCache.set(event.filePath, { process: subagentProcess, offset: event.currentSize });
                  }
                }
              } catch {
                // Parse failed — broadcast without data (fallback).
                // Do NOT update cache so the next event retries.
              }

              console.log('[SSE-DEBUG] Subagent-update broadcast:', {
                agentId,
                processId: subagentProcess?.id,
                numMessages: subagentProcess?.messages?.length ?? 0,
                isOngoing: subagentProcess?.isOngoing,
              });
              broadcastEvent('session-update', {
                projectId: event.projectId,
                sessionId: event.sessionId,
                type: 'subagent-update',
                ...(subagentProcess && { subagentProcess }),
              });
              return;
            }

            const update = await sessionPipeline.parseIncremental(
              fullProjectDir,
              event.sessionId,
              minOffset,
            );

            if (update.requiresFullRefresh) {
              broadcastEvent('session-update', {
                projectId: event.projectId,
                sessionId: event.sessionId,
                type: 'full-refresh',
              });
            } else if (update.newChunks.length === 0) {
              // No meaningful new data, skip broadcast
            } else {
              // TEMPORARY DEBUG LOG — remove after diagnosing SSE rendering issue
              console.log('[SSE-DEBUG] Broadcasting incremental update:', {
                numChunks: update.newChunks.length,
                chunks: update.newChunks.map((c, i) => ({
                  index: i,
                  type: c.type,
                  hasSemanticSteps: 'semanticSteps' in c,
                  numSteps: (c as any).semanticSteps?.length ?? 0,
                  numMessages: c.type === 'ai' ? c.messages?.length : undefined,
                })),
              });
              // Debug: log subagent data in incremental update
              for (const chunk of update.newChunks) {
                if (chunk.type === 'ai' && 'subagents' in chunk) {
                  const enhanced = chunk as any;
                  console.log('[SSE-DEBUG] Incremental chunk subagents:', {
                    numSubagents: enhanced.subagents?.length ?? 0,
                    subagents: enhanced.subagents?.map((s: any) => ({
                      id: s.id,
                      numMessages: s.messages?.length ?? 0,
                      firstMsgContent: typeof s.messages?.[0]?.content === 'string'
                        ? s.messages[0].content.substring(0, 50)
                        : 'non-string',
                    })),
                  });
                }
              }
              broadcastEvent('session-update', {
                projectId: event.projectId,
                sessionId: event.sessionId,
                type: 'incremental',
                newChunks: update.newChunks,
                metrics: update.metrics,
                isOngoing: update.isOngoing,
                newOffset: update.newOffset,
              });
            }

            // Always invalidate cache after broadcasting so next full page
            // load gets a fresh parse (the incremental data was a one-shot
            // push to connected SSE clients)
            sessionPipeline.invalidateSession(fullProjectDir, event.sessionId);
          } catch (err) {
            // On any error, fall back to full refresh
            console.error('Incremental parse failed, falling back to full refresh:', err);
            sessionPipeline?.invalidateSession(
              join(claudeProjectsDir, event.projectId),
              event.sessionId,
            );
            broadcastEvent('session-update', {
              projectId: event.projectId,
              sessionId: event.sessionId,
              type: 'full-refresh',
            });
          }
        })();
      }, 300);
      sseDebounceTimers.set(key, timer);
    });
  }

  // OrchestratorClient → SSE broadcast for session lifecycle events
  if (orchestratorClient) {
    const oc = orchestratorClient;

    oc.on('session-registered', (entry: SessionInfo) => {
      broadcastEvent('stage-transition', {
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        type: 'session_started',
        timestamp: entry.spawnedAt,
      });
    });

    oc.on('session-status', (entry: SessionInfo) => {
      broadcastEvent('board-update', {
        type: 'session_status',
        stageId: entry.stageId,
        sessionId: entry.sessionId,
        status: entry.status,
      });
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
    });
  }

  // --- Frontend remote logging ---
  const FRONTEND_LOG_PATH = '/tmp/claude-code-workflow.frontend.log';

  app.post<{ Body: { level: string; args: unknown[]; timestamp: string } }>(
    '/api/log',
    async (request, reply) => {
      const { level, args, timestamp } = request.body ?? {};
      const formattedArgs = (args ?? [])
        .map((a: unknown) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      const line = `[${timestamp}] [${String(level).toUpperCase()}] ${formattedArgs}\n`;
      try {
        appendFileSync(FRONTEND_LOG_PATH, line);
      } catch {
        // Ignore write errors (e.g. permission issues)
      }
      return reply.status(200).send({ ok: true });
    },
  );

  app.post('/api/log/clear', async (_request, reply) => {
    try {
      writeFileSync(FRONTEND_LOG_PATH, '');
    } catch {
      // Ignore write errors
    }
    return reply.status(200).send({ ok: true });
  });

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
