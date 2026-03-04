import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from '../../src/server/routes/auth.js';
import type { HostedAuthProvider } from '../../src/server/deployment/hosted/hosted-auth-provider.js';

/**
 * Create a mock HostedAuthProvider with controllable behavior.
 */
function createMockAuthProvider(overrides: Partial<HostedAuthProvider> = {}) {
  return {
    handleGitHubCallback: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      },
    }),
    refreshTokens: vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as HostedAuthProvider;
}

describe('auth routes', () => {
  let app: FastifyInstance;
  let mockAuthProvider: HostedAuthProvider;

  beforeEach(async () => {
    mockAuthProvider = createMockAuthProvider();
    app = Fastify({ logger: false });
    await app.register(authRoutes, {
      authProvider: mockAuthProvider,
      githubClientId: 'test-client-id',
      publicBaseUrl: 'https://app.example.com',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /auth/github', () => {
    it('redirects to GitHub OAuth URL with correct params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/github',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('https://github.com/login/oauth/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain(encodeURIComponent('https://app.example.com/auth/github/callback'));
      expect(location).toContain('scope=read%3Auser%2Cuser%3Aemail');
    });
  });

  describe('GET /auth/github/callback', () => {
    it('returns tokens and user on success', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/github/callback?code=test-code',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBe('mock-access-token');
      expect(body.refreshToken).toBe('mock-refresh-token');
      expect(body.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      });
      expect(mockAuthProvider.handleGitHubCallback).toHaveBeenCalledWith('test-code');
    });

    it('returns 400 when code is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/github/callback',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing authorization code');
    });

    it('returns 401 when callback fails', async () => {
      (mockAuthProvider.handleGitHubCallback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GitHub OAuth error: bad_verification_code'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/auth/github/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('GitHub OAuth error: bad_verification_code');
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new token pair on success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ refreshToken: 'old-refresh-token' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBe('new-access-token');
      expect(body.refreshToken).toBe('new-refresh-token');
      expect(mockAuthProvider.refreshTokens).toHaveBeenCalledWith('old-refresh-token');
    });

    it('returns 400 when refreshToken is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing refreshToken');
    });

    it('returns 401 on reuse detection', async () => {
      (mockAuthProvider.refreshTokens as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Refresh token reuse detected — session revoked'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ refreshToken: 'reused-token' }),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Refresh token reuse detected — session revoked');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes session and returns ok', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(mockAuthProvider.logout).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('returns 400 when refreshToken is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing refreshToken');
    });

    it('returns 500 when logout fails', async () => {
      (mockAuthProvider.logout as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection lost'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ refreshToken: 'some-token' }),
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database connection lost');
    });
  });
});
