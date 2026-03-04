import crypto from 'crypto';
import type {
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
  FastifyPluginCallback,
} from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthProvider, User } from '../types.js';
import type { PgPool } from './db/pg-client.js';
import { RoleService } from './rbac/role-service.js';

/** Shape of the access-token JWT payload. */
interface AccessTokenPayload {
  sub: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Shape of the refresh-token JWT payload. */
interface RefreshTokenPayload {
  sub: string;
  jti: string;
  sessionId: string;
  enc: string; // AES-256-GCM encrypted GitHub token
}

const ACCESS_TOKEN_EXPIRY = '120s';
const REFRESH_TOKEN_EXPIRY = '365d';
const AES_ALGORITHM = 'aes-256-gcm';

/**
 * Hosted auth provider using GitHub OAuth + JWT tokens.
 *
 * - GitHub OAuth callback exchanges code for GitHub access token, upserts user
 * - Issues short-lived access tokens (120s) and long-lived refresh tokens (365d)
 * - Refresh tokens contain AES-256-GCM encrypted GitHub tokens
 * - Rotation with reuse detection via revoked_refresh_tokens table
 */
export class HostedAuthProvider implements AuthProvider {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly jwtSecret: string,
    private readonly pool: PgPool,
    private readonly githubClientId: string,
    private readonly githubClientSecret: string,
  ) {
    // Derive a 32-byte key from the JWT secret for AES-256-GCM
    this.encryptionKey = crypto
      .createHash('sha256')
      .update(jwtSecret)
      .digest();
  }

  // ----------------------------------------------------------------
  // AuthProvider interface
  // ----------------------------------------------------------------

  async getAuthenticatedUser(request: FastifyRequest): Promise<User | null> {
    const header = request.headers.authorization;
    if (!header) return null;

    const token = header.replace('Bearer ', '');
    if (!token) return null;

    try {
      const payload = jwt.verify(token, this.jwtSecret) as AccessTokenPayload;
      return {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        displayName: payload.displayName,
        avatarUrl: payload.avatarUrl,
      };
    } catch {
      return null;
    }
  }

  requireAuth(): FastifyPluginCallback {
    return (app: FastifyInstance, _opts: Record<string, unknown>, done: () => void) => {
      app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await this.getAuthenticatedUser(request);
        if (!user) {
          reply.code(401).send({ error: 'Unauthorized' });
          return;
        }
        (request as FastifyRequest & { user: User }).user = user;
      });
      done();
    };
  }

  async getUserIdFromRequest(request: FastifyRequest): Promise<string> {
    const user = await this.getAuthenticatedUser(request);
    if (!user) throw new Error('Unauthorized');
    return user.id;
  }

  // ----------------------------------------------------------------
  // GitHub OAuth
  // ----------------------------------------------------------------

  /**
   * Exchange a GitHub authorization code for tokens and upsert the user.
   * Returns { accessToken, refreshToken } on success.
   */
  async handleGitHubCallback(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
  }> {
    // 1. Exchange code for GitHub access token
    const ghToken = await this.exchangeCodeForToken(code);

    // 2. Fetch GitHub user profile
    const ghUser = await this.fetchGitHubUser(ghToken);

    // 3. Upsert user + oauth_account
    const user = await this.upsertUser(ghUser);

    // 3b. Bootstrap first user as global_admin
    const roleService = new RoleService(this.pool);
    await roleService.bootstrapFirstUser(user.id);

    // 4. Create auth session
    const sessionId = crypto.randomUUID();
    const refreshTokenId = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO auth_sessions (id, user_id, refresh_token_id)
       VALUES ($1, $2, $3)`,
      [sessionId, user.id, refreshTokenId],
    );

    // 5. Issue tokens
    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(
      user.id,
      refreshTokenId,
      sessionId,
      ghToken,
    );

    return { accessToken, refreshToken, user };
  }

  /**
   * Rotate a refresh token. Validates the old token, revokes it,
   * and issues a new token pair. Implements reuse detection.
   */
  async refreshTokens(oldRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(oldRefreshToken, this.jwtSecret) as RefreshTokenPayload;
    } catch {
      throw new Error('Invalid refresh token');
    }

    const { sub: userId, jti: tokenId, sessionId, enc } = payload;

    // Check if token was already revoked (reuse detection)
    const revokedResult = await this.pool.query(
      'SELECT token_id FROM revoked_refresh_tokens WHERE token_id = $1',
      [tokenId],
    );

    if (revokedResult.rows.length > 0) {
      // Token reuse detected -- revoke entire session
      await this.pool.query(
        `UPDATE auth_sessions SET revoked_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId],
      );
      throw new Error('Refresh token reuse detected — session revoked');
    }

    // Verify session is still active
    const sessionResult = await this.pool.query(
      'SELECT id FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );

    if (sessionResult.rows.length === 0) {
      throw new Error('Session has been revoked');
    }

    // Revoke old token
    await this.pool.query(
      `INSERT INTO revoked_refresh_tokens (token_id, user_id, revoked_reason)
       VALUES ($1, $2, $3)`,
      [tokenId, userId, 'rotated'],
    );

    // Fetch user for access token claims
    const userResult = await this.pool.query(
      'SELECT id, email, username, display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const row = userResult.rows[0];
    const user: User = {
      id: row.id,
      email: row.email,
      username: row.username ?? undefined,
      displayName: row.display_name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
    };

    // Decrypt the GitHub token from the old refresh token
    const ghToken = this.decrypt(enc);

    // Issue new token pair
    const newRefreshTokenId = crypto.randomUUID();

    // Update session with new refresh token ID
    await this.pool.query(
      `UPDATE auth_sessions SET refresh_token_id = $1, last_used_at = NOW()
       WHERE id = $2`,
      [newRefreshTokenId, sessionId],
    );

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(
      userId,
      newRefreshTokenId,
      sessionId,
      ghToken,
    );

    return { accessToken, refreshToken };
  }

  /**
   * Revoke a refresh token's session (logout).
   * Marks the session as revoked and adds the token to the revoked list.
   */
  async logout(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(refreshToken, this.jwtSecret) as RefreshTokenPayload;
    } catch {
      // Token is already expired or invalid — treat as successful logout
      return;
    }

    const { jti: tokenId, sub: userId, sessionId } = payload;

    // Revoke the session
    await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );

    // Mark the refresh token as revoked
    await this.pool.query(
      `INSERT INTO revoked_refresh_tokens (token_id, user_id, revoked_reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_id) DO NOTHING`,
      [tokenId, userId, 'logout'],
    );
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  private async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
      }),
    });

    const data = (await response.json()) as { access_token?: string; error?: string };
    if (!data.access_token) {
      throw new Error(`GitHub OAuth error: ${data.error ?? 'no access_token returned'}`);
    }
    return data.access_token;
  }

  private async fetchGitHubUser(token: string): Promise<{
    id: number;
    login: string;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
  }> {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const profile = (await response.json()) as {
      id: number;
      login: string;
      email: string | null;
      name: string | null;
      avatar_url: string | null;
    };

    // If email is private, fetch from /user/emails
    if (!profile.email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (primary) {
          profile.email = primary.email;
        }
      }
    }

    if (!profile.email) {
      throw new Error('Could not obtain email from GitHub — ensure the user:email scope is granted');
    }

    return profile;
  }

  private async upsertUser(ghUser: {
    id: number;
    login: string;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
  }): Promise<User> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert user by email
      const userResult = await client.query(
        `INSERT INTO users (email, username, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           username = COALESCE(EXCLUDED.username, users.username),
           display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
         RETURNING id, email, username, display_name, avatar_url`,
        [ghUser.email, ghUser.login, ghUser.name, ghUser.avatar_url],
      );

      const row = userResult.rows[0];

      // Upsert oauth_account
      await client.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO UPDATE SET
           email = EXCLUDED.email`,
        [row.id, 'github', String(ghUser.id), ghUser.email],
      );

      await client.query('COMMIT');

      return {
        id: row.id,
        email: row.email,
        username: row.username ?? undefined,
        displayName: row.display_name ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
    return jwt.sign(payload, this.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY });
  }

  private signRefreshToken(
    userId: string,
    tokenId: string,
    sessionId: string,
    ghToken: string,
  ): string {
    const payload: RefreshTokenPayload = {
      sub: userId,
      jti: tokenId,
      sessionId,
      enc: this.encrypt(ghToken),
    };
    return jwt.sign(payload, this.jwtSecret, { expiresIn: REFRESH_TOKEN_EXPIRY });
  }

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv:tag:ciphertext (all hex-encoded)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(encoded: string): string {
    const [ivHex, tagHex, ciphertextHex] = encoded.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  }
}
