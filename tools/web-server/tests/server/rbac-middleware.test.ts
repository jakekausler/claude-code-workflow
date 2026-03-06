import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireRole, ROLE_HIERARCHY } from '../../src/server/deployment/hosted/rbac/rbac-middleware.js';
import type { RoleService, RoleName } from '../../src/server/deployment/hosted/rbac/role-service.js';

function makeRequest(userId?: string, params?: Record<string, string>): FastifyRequest {
  return {
    user: userId ? { id: userId } : undefined,
    params: params ?? {},
    body: null,
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { _code: number; _body: unknown } {
  const reply = {
    _code: 0,
    _body: undefined as unknown,
    code(status: number) {
      reply._code = status;
      return reply;
    },
    send(body: unknown) {
      reply._body = body;
      return reply;
    },
  };
  return reply as FastifyReply & { _code: number; _body: unknown };
}

function makeRoleService(role: RoleName | null): RoleService {
  return {
    getUserRole: vi.fn().mockResolvedValue(role),
  } as unknown as RoleService;
}

describe('requireRole middleware', () => {
  describe('ROLE_HIERARCHY export', () => {
    it('orders roles correctly: viewer < developer < admin < global_admin', () => {
      expect(ROLE_HIERARCHY['viewer']).toBeLessThan(ROLE_HIERARCHY['developer']);
      expect(ROLE_HIERARCHY['developer']).toBeLessThan(ROLE_HIERARCHY['admin']);
      expect(ROLE_HIERARCHY['admin']).toBeLessThan(ROLE_HIERARCHY['global_admin']);
    });
  });

  describe('unauthenticated request', () => {
    it('returns 401 when no user is present', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest(undefined);
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(401);
      expect((reply._body as Record<string, string>).error).toBe('Unauthorized');
    });
  });

  describe('authorized request', () => {
    it('allows a user whose role meets the minimum', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      // No code/send called means the handler passed through
      expect(reply._code).toBe(0);
      expect(reply._body).toBeUndefined();
    });

    it('allows a user with a higher role than minimum', async () => {
      const roleService = makeRoleService('admin');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(0);
      expect(reply._body).toBeUndefined();
    });

    it('allows global_admin for any role requirement', async () => {
      const roleService = makeRoleService('global_admin');
      const handler = requireRole(roleService, 'admin');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(0);
    });
  });

  describe('unauthorized request', () => {
    it('returns 403 when user role is below minimum', async () => {
      const roleService = makeRoleService('viewer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(403);
      const body = reply._body as Record<string, string>;
      expect(body.error).toBe('Insufficient permissions');
      expect(body.required).toBe('developer');
      expect(body.actual).toBe('viewer');
    });

    it('returns 403 when user has no role assigned', async () => {
      const roleService = makeRoleService(null);
      const handler = requireRole(roleService, 'viewer');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(403);
      const body = reply._body as Record<string, string>;
      expect(body.actual).toBe('none');
    });

    it('returns 403 when developer tries to access admin-only endpoint', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'admin');
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(403);
      const body = reply._body as Record<string, string>;
      expect(body.error).toBe('Insufficient permissions');
      expect(body.required).toBe('admin');
      expect(body.actual).toBe('developer');
    });
  });

  describe('write enforcement for POST /api/tickets', () => {
    it('returns 403 for viewer role trying to write', async () => {
      const roleService = makeRoleService('viewer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-viewer');
      const reply = makeReply();

      await handler(request, reply);

      expect(reply._code).toBe(403);
      const body = reply._body as Record<string, string>;
      expect(body.error).toBe('Insufficient permissions');
      expect(body.required).toBe('developer');
      expect(body.actual).toBe('viewer');
    });

    it('allows developer role to POST /api/tickets', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-developer');
      const reply = makeReply();

      await handler(request, reply);

      // Handler passes through — no code/send called
      expect(reply._code).toBe(0);
      expect(reply._body).toBeUndefined();
    });
  });

  describe('repoId extraction', () => {
    it('passes repoId from params to getUserRole', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'developer');
      const request = makeRequest('user-1', { repoId: '42' });
      const reply = makeReply();

      await handler(request, reply);

      expect(roleService.getUserRole).toHaveBeenCalledWith('user-1', '42');
    });

    it('uses custom getRepoId when provided', async () => {
      const roleService = makeRoleService('developer');
      const handler = requireRole(roleService, 'developer', {
        getRepoId: () => 'custom-repo',
      });
      const request = makeRequest('user-1');
      const reply = makeReply();

      await handler(request, reply);

      expect(roleService.getUserRole).toHaveBeenCalledWith('user-1', 'custom-repo');
    });
  });
});
