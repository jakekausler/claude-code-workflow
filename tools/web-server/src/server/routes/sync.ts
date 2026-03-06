import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';
import { requireRole } from '../deployment/hosted/rbac/rbac-middleware.js';
import type { IssueSyncService } from '../services/issue-sync-service.js';
import type { IssueSyncScheduler } from '../services/issue-sync-scheduler.js';

export interface SyncRouteOptions {
  syncService: IssueSyncService;
  syncScheduler: IssueSyncScheduler;
  roleService?: RoleService;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createConfigSchema = z.object({
  repo_id: z.number().int().positive(),
  provider: z.enum(['github', 'gitlab']),
  remote_owner: z.string().nullable().optional().default(null),
  remote_repo: z.string().nullable().optional().default(null),
  instance_url: z.string().nullable().optional().default(null),
  token: z.string().nullable().optional().default(null),
  labels: z.array(z.string()).optional().default([]),
  milestones: z.array(z.string()).optional().default([]),
  assignees: z.array(z.string()).optional().default([]),
  enabled: z.boolean().optional().default(true),
  interval_ms: z.number().int().positive().optional().default(3600000),
});

const updateConfigSchema = z.object({
  repo_id: z.number().int().positive().optional(),
  provider: z.enum(['github', 'gitlab']).optional(),
  remote_owner: z.string().nullable().optional(),
  remote_repo: z.string().nullable().optional(),
  instance_url: z.string().nullable().optional(),
  token: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  milestones: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  interval_ms: z.number().int().positive().optional(),
});

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const syncPlugin: FastifyPluginCallback<SyncRouteOptions> = (app, opts, done) => {
  const { syncService, syncScheduler, roleService } = opts;

  const protectedOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  // GET /api/sync/configs — list all sync configs
  app.get('/api/sync/configs', protectedOpts, async (_request, reply) => {
    const configs = await syncService.getConfigs();
    return reply.send({ configs });
  });

  // POST /api/sync/configs — create sync config
  app.post('/api/sync/configs', protectedOpts, async (request, reply) => {
    const parseResult = createConfigSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }

    const config = await syncService.createConfig(parseResult.data);
    syncScheduler.addConfig(config);
    return reply.status(201).send({ config });
  });

  // PUT /api/sync/configs/:id — update sync config
  app.put('/api/sync/configs/:id', protectedOpts, async (request, reply) => {
    const paramResult = idParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: 'Invalid id parameter' });
    }

    const bodyResult = updateConfigSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: bodyResult.error.issues });
    }

    const updated = await syncService.updateConfig(paramResult.data.id, bodyResult.data);
    if (!updated) {
      return reply.status(404).send({ error: 'Config not found' });
    }

    // Reschedule the job with updated config
    syncScheduler.removeConfig(updated.id);
    syncScheduler.addConfig(updated);

    return reply.send({ config: updated });
  });

  // DELETE /api/sync/configs/:id — delete sync config
  app.delete('/api/sync/configs/:id', protectedOpts, async (request, reply) => {
    const paramResult = idParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: 'Invalid id parameter' });
    }

    syncScheduler.removeConfig(paramResult.data.id);
    const deleted = await syncService.deleteConfig(paramResult.data.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Config not found' });
    }

    return reply.send({ success: true });
  });

  // POST /api/sync/configs/:id/trigger — trigger immediate sync
  app.post('/api/sync/configs/:id/trigger', protectedOpts, async (request, reply) => {
    const paramResult = idParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: 'Invalid id parameter' });
    }

    try {
      const result = await syncScheduler.triggerSync(paramResult.data.id);
      return reply.send({ result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // GET /api/sync/status — all sync status
  app.get('/api/sync/status', protectedOpts, async (_request, reply) => {
    const statuses = await syncService.getAllStatuses();
    return reply.send({ statuses });
  });

  // GET /api/sync/status/:id — status for specific config
  app.get('/api/sync/status/:id', protectedOpts, async (request, reply) => {
    const paramResult = idParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: 'Invalid id parameter' });
    }

    const status = await syncService.getStatus(paramResult.data.id);
    if (!status) {
      return reply.send({ status: null });
    }
    return reply.send({ status });
  });

  done();
};

export const syncRoutes = fp(syncPlugin, { name: 'sync-routes' });
