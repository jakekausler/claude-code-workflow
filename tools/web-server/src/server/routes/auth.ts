import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { HostedAuthProvider } from '../deployment/hosted/hosted-auth-provider.js';

export interface AuthRouteOptions {
  authProvider: HostedAuthProvider;
  /** GitHub OAuth client ID (read from env if not provided). */
  githubClientId?: string;
  /** Base URL for OAuth redirect (e.g. https://myapp.com). */
  publicBaseUrl?: string;
}

const authPlugin: FastifyPluginCallback<AuthRouteOptions> = (app, opts, done) => {
  const { authProvider } = opts;
  const githubClientId = opts.githubClientId ?? process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
  const publicBaseUrl = opts.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '';

  /**
   * GET /auth/github — Redirect to GitHub OAuth authorization page.
   */
  app.get('/auth/github', async (_request, reply) => {
    const redirectUri = `${publicBaseUrl}/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: githubClientId,
      redirect_uri: redirectUri,
      scope: 'read:user,user:email',
    });
    return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  /**
   * GET /auth/github/callback — Exchange authorization code for tokens.
   * Returns { accessToken, refreshToken, user } on success.
   */
  app.get('/auth/github/callback', async (request, reply) => {
    const { code } = request.query as { code?: string };

    if (!code) {
      return reply.code(400).send({ error: 'Missing authorization code' });
    }

    try {
      const result = await authProvider.handleGitHubCallback(code);
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth callback failed';
      return reply.code(401).send({ error: message });
    }
  });

  /**
   * POST /auth/refresh — Rotate a refresh token.
   * Expects { refreshToken } in the request body.
   * Returns new { accessToken, refreshToken }.
   */
  app.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };

    if (!refreshToken) {
      return reply.code(400).send({ error: 'Missing refreshToken' });
    }

    try {
      const result = await authProvider.refreshTokens(refreshToken);
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token refresh failed';
      // Reuse detection or invalid token → 401
      return reply.code(401).send({ error: message });
    }
  });

  /**
   * POST /auth/logout — Revoke the current session.
   * Expects { refreshToken } in the request body.
   */
  app.post('/auth/logout', async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };

    if (!refreshToken) {
      return reply.code(400).send({ error: 'Missing refreshToken' });
    }

    try {
      await authProvider.logout(refreshToken);
      return reply.send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      return reply.code(500).send({ error: message });
    }
  });

  done();
};

export const authRoutes = fp(authPlugin, { name: 'auth-routes' });
