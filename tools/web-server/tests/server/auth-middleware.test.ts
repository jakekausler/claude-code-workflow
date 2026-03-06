import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { createServer } from '../../src/server/app.js';
import { HostedAuthProvider } from '../../src/server/deployment/hosted/hosted-auth-provider.js';
import type {
  DeploymentContext,
  AuthProvider,
  FileSystemProvider,
  EventBroadcaster,
} from '../../src/server/deployment/types.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ----------------------------------------------------------------
// Minimal mock DeploymentContext that uses a real HostedAuthProvider
// (JWT validation only — no DB queries needed for requireAuth).
// ----------------------------------------------------------------

const TEST_JWT_SECRET = 'test-secret-for-auth-middleware-tests';

function makeMockPool() {
  return {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
  };
}

function makeHostedDeploymentContext(): DeploymentContext & {
  getHostedAuthProvider(): HostedAuthProvider;
  getPool(): ReturnType<typeof makeMockPool>;
  mode: 'hosted';
} {
  const pool = makeMockPool() as any;
  const authProvider = new HostedAuthProvider(
    TEST_JWT_SECRET,
    pool,
    'mock-gh-client-id',
    'mock-gh-client-secret',
  );

  const mockBroadcaster: EventBroadcaster = {
    clientCount: 0,
    addClient: () => {},
    removeClient: () => {},
    broadcast: () => {},
  };

  return {
    mode: 'hosted' as const,
    async getUserId(request: FastifyRequest): Promise<string> {
      return authProvider.getUserIdFromRequest(request);
    },
    getFileAccess(): FileSystemProvider {
      throw new Error('Not implemented in test');
    },
    getAuthProvider(): AuthProvider {
      return authProvider;
    },
    getEventBroadcaster(): EventBroadcaster {
      return mockBroadcaster;
    },
    getClaudeRoot(userId: string): string {
      return `/home/${userId}/.claude`;
    },
    getHostedAuthProvider(): HostedAuthProvider {
      return authProvider;
    },
    getPool() {
      return pool;
    },
  };
}

function makeValidAccessToken(): string {
  return jwt.sign(
    {
      sub: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
    },
    TEST_JWT_SECRET,
    { expiresIn: '120s' },
  );
}

// ----------------------------------------------------------------
// Tests: hosted mode — protected /api/* routes require auth
// ----------------------------------------------------------------

describe('auth middleware (hosted mode)', () => {
  let app: FastifyInstance;
  let deploymentContext: ReturnType<typeof makeHostedDeploymentContext>;

  beforeEach(async () => {
    deploymentContext = makeHostedDeploymentContext();
    app = await createServer({
      logger: false,
      isDev: true,
      deploymentContext,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated request to /api/health with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects unauthenticated request to /api/board with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects unauthenticated request to /api/me with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects request with invalid Bearer token with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects request with expired token with 401', async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-123', email: 'test@example.com' },
      TEST_JWT_SECRET,
      { expiresIn: -1 }, // already expired
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('allows authenticated request to /api/health with valid token', async () => {
    const token = makeValidAccessToken();

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  it('allows authenticated request to /api/me with valid token', async () => {
    const token = makeValidAccessToken();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { Authorization: `Bearer ${token}` },
    });

    // 200 with hosted mode user info
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.mode).toBe('hosted');
  });
});

// ----------------------------------------------------------------
// Tests: /auth/* routes are public (no token required)
// ----------------------------------------------------------------

describe('auth routes are public (hosted mode)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const deploymentContext = makeHostedDeploymentContext();
    app = await createServer({
      logger: false,
      isDev: true,
      deploymentContext,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /auth/github redirects without requiring a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/github',
    });

    // Should redirect to GitHub OAuth, not 401
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/github\.com\/login\/oauth\/authorize/);
  });

  it('POST /auth/refresh is accessible without a Bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token' }),
    });

    // 401 from bad token — NOT from auth middleware (which would also be 401
    // but the error message would differ). The route itself handles the error.
    // Key assertion: it is NOT blocked by the preHandler returning before route runs.
    // We can distinguish: middleware 401 has { error: 'Unauthorized' },
    // route-level 401 has { error: <token error message> }.
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).not.toBe('Unauthorized');
  });

  it('POST /auth/logout is accessible without a Bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token' }),
    });

    // logout is best-effort — invalid token is treated as successful
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });
});

// ----------------------------------------------------------------
// Tests: local mode — all routes pass through without auth
// ----------------------------------------------------------------

describe('auth middleware (local mode — no-op)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer({ logger: false, isDev: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health succeeds without any Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  it('GET /api/me succeeds without any Authorization header in local mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.mode).toBe('local');
    expect(body.user).toBeNull();
  });
});
