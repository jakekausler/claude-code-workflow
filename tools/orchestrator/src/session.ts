import { spawn as nodeSpawn } from 'node:child_process';

/**
 * Options for spawning a Claude Code session.
 */
export interface SpawnOptions {
  stageId: string;
  stageFilePath: string;
  skillName: string;
  worktreePath: string;
  worktreeIndex: number;
  model: string;
  workflowEnv: Record<string, string>;
}

/**
 * Result of a completed session.
 */
export interface SessionResult {
  exitCode: number;
  durationMs: number;
}

/**
 * A currently running session that can be inspected or killed.
 */
export interface ActiveSession {
  pid: number;
  kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Minimal interface for session log output.
 * Compatible with SessionLogger from logger.ts without tight coupling.
 */
export interface SessionLoggerLike {
  write(data: string): void;
}

/**
 * Options passed to the spawnProcess function.
 */
export interface SpawnProcessOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  stdio: ['pipe', 'pipe', 'pipe'];
}

/**
 * Minimal child process interface for dependency injection.
 */
export interface ChildProcessLike {
  pid: number | undefined;
  stdin: { write(data: string): boolean; end(): void };
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  on(event: 'close', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Injectable dependencies for the session executor.
 */
export interface SessionDeps {
  spawnProcess: (command: string, args: string[], options: SpawnProcessOptions) => ChildProcessLike;
  now: () => number;
}

/**
 * Session executor interface for spawning and managing Claude Code sessions.
 */
export interface SessionExecutor {
  spawn(options: SpawnOptions, sessionLogger: SessionLoggerLike): Promise<SessionResult>;
  getActiveSessions(): ActiveSession[];
  killAll(signal?: NodeJS.Signals): void;
}

function defaultSpawnProcess(command: string, args: string[], options: SpawnProcessOptions): ChildProcessLike {
  // Double cast needed: node ChildProcess uses complex overloaded signatures for
  // on()/kill()/stdin that are structurally incompatible with our minimal interface.
  return nodeSpawn(command, args, options) as unknown as ChildProcessLike;
}

const defaultDeps: SessionDeps = {
  spawnProcess: defaultSpawnProcess,
  now: () => Date.now(),
};

/**
 * Build a prompt string that instructs Claude to invoke skills.
 * Exported for testing.
 */
export function assemblePrompt(options: SpawnOptions): string {
  const lines: string[] = [
    `You are working on stage ${options.stageId}.`,
    '',
    `Stage file: ${options.stageFilePath}`,
    `Worktree path: ${options.worktreePath}`,
    `Worktree index: ${options.worktreeIndex}`,
    '',
    'Invoke the `ticket-stage-workflow` skill to load shared context.',
    `Then invoke the \`${options.skillName}\` skill to begin work on this stage.`,
    '',
    'Environment configuration:',
  ];

  const sortedKeys = Object.keys(options.workflowEnv).sort();
  for (const key of sortedKeys) {
    lines.push(`- ${key}=${options.workflowEnv[key]}`);
  }

  return lines.join('\n');
}

/**
 * Create a SessionExecutor that spawns Claude Code sessions as child processes.
 */
export function createSessionExecutor(deps: Partial<SessionDeps> = {}): SessionExecutor {
  const resolved: SessionDeps = { ...defaultDeps, ...deps };
  const activeSessions = new Map<number, ActiveSession>();

  return {
    spawn(options: SpawnOptions, sessionLogger: SessionLoggerLike): Promise<SessionResult> {
      return new Promise((resolve, reject) => {
        const prompt = assemblePrompt(options);
        const startTime = resolved.now();

        const child = resolved.spawnProcess('claude', ['-p', '--model', options.model], {
          cwd: options.worktreePath,
          env: {
            ...process.env,
            WORKTREE_INDEX: String(options.worktreeIndex),
            ...options.workflowEnv,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Register all event handlers BEFORE writing to stdin so that
        // errors during spawn are captured even if they fire synchronously.
        child.stdout.on('data', (chunk: Buffer) => {
          sessionLogger.write(chunk.toString());
        });

        child.stderr.on('data', (chunk: Buffer) => {
          sessionLogger.write(chunk.toString());
        });

        let settled = false;

        child.on('close', (code: number | null) => {
          if (settled) return;
          settled = true;

          const endTime = resolved.now();
          if (child.pid !== undefined) {
            activeSessions.delete(child.pid);
          }

          resolve({
            exitCode: code ?? 1,
            durationMs: endTime - startTime,
          });
        });

        child.on('error', (err: Error) => {
          if (settled) return;
          settled = true;

          if (child.pid !== undefined) {
            activeSessions.delete(child.pid);
          }

          reject(err);
        });

        // Track as active session if we have a pid
        if (child.pid !== undefined) {
          const session: ActiveSession = {
            pid: child.pid,
            kill(signal?: NodeJS.Signals): boolean {
              return child.kill(signal);
            },
          };
          activeSessions.set(child.pid, session);
        }

        // Only write to stdin if the process spawned successfully (has a pid).
        // If pid is undefined, the spawn failed and stdin operations should be skipped.
        if (child.pid !== undefined) {
          child.stdin.write(prompt);
          child.stdin.end();
        }
      });
    },

    getActiveSessions(): ActiveSession[] {
      return Array.from(activeSessions.values());
    },

    killAll(signal?: NodeJS.Signals): void {
      for (const session of activeSessions.values()) {
        const killed = session.kill(signal ?? 'SIGTERM');
        if (!killed) {
          console.error(`Failed to send ${signal ?? 'SIGTERM'} to session pid=${session.pid}`);
        }
      }
    },
  };
}
