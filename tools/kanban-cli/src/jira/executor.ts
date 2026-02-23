import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ZodType, ZodTypeDef } from 'zod';
import type { JiraConfig } from '../types/pipeline.js';
import type {
  JiraExecutor,
  JiraTicketData,
  JiraSearchResult,
  JiraTransitionResult,
  JiraAssignResult,
  JiraCommentResult,
} from './types.js';
import {
  jiraTicketDataSchema,
  jiraSearchResultSchema,
  jiraTransitionResultSchema,
  jiraAssignResultSchema,
  jiraCommentResultSchema,
} from './schemas.js';

/** Default timeout for script execution in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Error thrown when a Jira script fails.
 */
export class JiraScriptError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'JiraScriptError';
  }
}

/**
 * Error thrown when a Jira script times out.
 */
export class JiraTimeoutError extends Error {
  constructor(
    public readonly scriptPath: string,
    public readonly timeoutMs: number,
  ) {
    super(`Jira script timed out after ${timeoutMs}ms: ${scriptPath}`);
    this.name = 'JiraTimeoutError';
  }
}

/**
 * Error thrown when a Jira script's stdout fails schema validation.
 */
export class JiraValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'JiraValidationError';
  }
}

/**
 * Resolve a script path: absolute paths are used as-is,
 * relative paths are resolved from the repoRoot.
 */
function resolveScriptPath(scriptPath: string, repoRoot: string): string {
  if (path.isAbsolute(scriptPath)) {
    return scriptPath;
  }
  return path.resolve(repoRoot, scriptPath);
}

/**
 * Execute a script by spawning `npx tsx <scriptPath>`, writing JSON to stdin,
 * collecting stdout/stderr, and validating the output against a Zod schema.
 */
function executeScript<T>(
  scriptPath: string,
  input: unknown,
  outputSchema: ZodType<T, ZodTypeDef, unknown>,
  repoRoot: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const resolved = resolveScriptPath(scriptPath, repoRoot);

  return new Promise<T>((resolve, reject) => {
    const child = spawn('npx', ['tsx', resolved], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoRoot,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new JiraTimeoutError(resolved, timeoutMs));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      if (killed) {
        // Already rejected by timeout handler
        return;
      }

      if (exitCode !== 0) {
        // Try to parse stderr as JSON for structured error
        let message: string;
        try {
          const parsed = JSON.parse(stderr);
          message = parsed.error || parsed.message || stderr;
        } catch {
          message = stderr.trim() || `Script exited with code ${exitCode}`;
        }
        reject(new JiraScriptError(message, exitCode, stderr));
        return;
      }

      // Parse and validate stdout
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(
          new JiraValidationError(
            `Script output is not valid JSON: ${stdout.slice(0, 200)}`,
            stdout,
          ),
        );
        return;
      }

      const result = outputSchema.safeParse(parsed);
      if (!result.success) {
        reject(
          new JiraValidationError(
            `Script output failed schema validation: ${result.error.message}`,
            stdout,
          ),
        );
        return;
      }

      resolve(result.data);
    });

    // Prevent unhandled error events if child process exits before stdin is fully consumed
    child.stdin.on('error', () => {
      // Swallow — the 'close' handler will surface the real error via non-zero exit
    });

    // Write input to stdin and close
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/**
 * Options for creating a JiraExecutor.
 */
export interface JiraExecutorOptions {
  /** Timeout in milliseconds for script execution. Defaults to 30000. */
  timeoutMs?: number;
}

/**
 * Create a JiraExecutor that spawns configured scripts with JSON stdin/stdout.
 *
 * The executor does NOT make Jira API calls directly — it delegates to
 * external scripts specified in the JiraConfig.
 */
export function createJiraExecutor(
  config: JiraConfig,
  repoRoot: string,
  options: JiraExecutorOptions = {},
): JiraExecutor {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readingScript = config.reading_script ?? null;
  const writingScript = config.writing_script ?? null;

  function requireReadScript(): string {
    if (readingScript == null) {
      throw new Error(
        'Jira reading not configured: reading_script is not set in pipeline config',
      );
    }
    return readingScript;
  }

  function requireWriteScript(): string {
    if (writingScript == null) {
      throw new Error(
        'Jira writing not configured: writing_script is not set in pipeline config',
      );
    }
    return writingScript;
  }

  return {
    async getTicket(key: string): Promise<JiraTicketData> {
      const script = requireReadScript();
      return executeScript<JiraTicketData>(
        script,
        { operation: 'get-ticket', key },
        jiraTicketDataSchema,
        repoRoot,
        timeout,
      );
    },

    async searchTickets(jql: string, maxResults?: number): Promise<JiraSearchResult> {
      const script = requireReadScript();
      return executeScript(
        script,
        { operation: 'search-tickets', jql, max_results: maxResults ?? 50 },
        jiraSearchResultSchema,
        repoRoot,
        timeout,
      );
    },

    async transitionTicket(key: string, targetStatus: string): Promise<JiraTransitionResult> {
      const script = requireWriteScript();
      return executeScript(
        script,
        { operation: 'transition-ticket', key, target_status: targetStatus },
        jiraTransitionResultSchema,
        repoRoot,
        timeout,
      );
    },

    async assignTicket(key: string, assignee: string | null): Promise<JiraAssignResult> {
      const script = requireWriteScript();
      return executeScript(
        script,
        { operation: 'assign-ticket', key, assignee },
        jiraAssignResultSchema,
        repoRoot,
        timeout,
      );
    },

    async addComment(key: string, body: string): Promise<JiraCommentResult> {
      const script = requireWriteScript();
      return executeScript(
        script,
        { operation: 'add-comment', key, body },
        jiraCommentResultSchema,
        repoRoot,
        timeout,
      );
    },

    canRead(): boolean {
      return readingScript != null;
    },

    canWrite(): boolean {
      return writingScript != null;
    },
  };
}
