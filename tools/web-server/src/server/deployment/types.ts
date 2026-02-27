import type { FastifyRequest, FastifyReply, FastifyPluginCallback } from 'fastify';
import type { ReadStream } from 'fs';
import type { FSWatcher } from 'fs';

/**
 * Authenticated user representation.
 * Local mode never returns a User (no auth concept).
 * Hosted mode returns user from JWT/OAuth validation.
 */
export interface User {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Abstraction over filesystem access.
 * Local mode: direct fs access with no restrictions.
 * Hosted mode: scoped to user's home directory with path traversal protection.
 */
export interface FileSystemProvider {
  readonly type: 'local' | 'scoped';
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean }>;
  exists(path: string): Promise<boolean>;
  createReadStream(path: string, options?: { start?: number; encoding?: BufferEncoding }): ReadStream;
  watch(path: string, options?: { recursive?: boolean }): FSWatcher;
}

/**
 * Authentication middleware abstraction.
 * Local mode: no-op (single-user, no auth required).
 * Hosted mode: JWT validation, 401 for unauthenticated requests.
 */
export interface AuthProvider {
  getAuthenticatedUser(request: FastifyRequest): Promise<User | null>;
  requireAuth(): FastifyPluginCallback;
  getUserIdFromRequest(request: FastifyRequest): Promise<string>;
}

/**
 * SSE broadcast abstraction with optional user scoping.
 * Local mode: broadcasts to all connected clients.
 * Hosted mode: broadcasts to user-scoped client sets.
 */
export interface EventBroadcaster {
  addClient(reply: FastifyReply, scope?: { userId: string }): void;
  removeClient(reply: FastifyReply): void;
  broadcast(event: string, data: unknown, scope?: { userId?: string }): void;
}

/**
 * Top-level deployment context that provides all deployment-specific services.
 * Selected at server startup based on DEPLOYMENT_MODE env var.
 */
export interface DeploymentContext {
  readonly mode: 'local' | 'hosted';
  getUserId(request: FastifyRequest): Promise<string>;
  getFileAccess(): FileSystemProvider;
  getAuthProvider(): AuthProvider;
  getEventBroadcaster(): EventBroadcaster;
  getClaudeRoot(userId: string): string;
}
