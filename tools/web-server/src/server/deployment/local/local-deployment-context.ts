import path from 'path';
import os from 'os';
import type { FastifyRequest } from 'fastify';
import type { DeploymentContext, FileSystemProvider, AuthProvider, EventBroadcaster } from '../types.js';
import { DirectFileSystemProvider } from './direct-fs-provider.js';
import { NoopAuthProvider } from './noop-auth-provider.js';
import { BroadcastAllSSE } from './broadcast-all-sse.js';

/**
 * Local (single-user) deployment context.
 * No auth, direct filesystem, broadcast to all SSE clients.
 */
export class LocalDeploymentContext implements DeploymentContext {
  readonly mode = 'local' as const;

  private readonly fileAccess = new DirectFileSystemProvider();
  private readonly authProvider = new NoopAuthProvider();
  private readonly eventBroadcaster = new BroadcastAllSSE();

  async getUserId(_request: FastifyRequest): Promise<string> {
    return 'local-user';
  }

  getFileAccess(): FileSystemProvider {
    return this.fileAccess;
  }

  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  getEventBroadcaster(): EventBroadcaster {
    return this.eventBroadcaster;
  }

  getClaudeRoot(_userId: string): string {
    return process.env.CLAUDE_ROOT || path.join(os.homedir(), '.claude');
  }
}
