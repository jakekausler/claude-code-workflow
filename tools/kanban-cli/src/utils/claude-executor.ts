import { execFileSync } from 'node:child_process';

/**
 * Interface for executing Claude CLI summarization prompts.
 * Injectable for testing — tests provide a mock, production uses the real CLI.
 */
export interface ClaudeExecutor {
  /**
   * Send a prompt to Claude and return the response text.
   * @param prompt The full prompt to send
   * @param model The model to use (e.g., 'haiku', 'sonnet')
   * @returns The response text from Claude
   * @throws If the CLI call fails
   */
  execute(prompt: string, model: string): string;
}

/**
 * Options for constructing the Claude executor.
 */
export interface ClaudeExecutorOptions {
  /**
   * Function to execute the `claude` CLI. Defaults to execFileSync.
   * Injected for testing.
   */
  execFn?: (command: string, args: string[], input?: string) => string;
}

function defaultExec(command: string, args: string[], input?: string): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 10, // 10MB
    ...(input !== undefined ? { input } : {}),
  });
}

/**
 * Create a ClaudeExecutor that shells out to `claude -p --model <model>`.
 *
 * Follows the same injectable exec pattern as code-host-github.ts.
 */
export function createClaudeExecutor(options: ClaudeExecutorOptions = {}): ClaudeExecutor {
  const exec = options.execFn ?? defaultExec;

  return {
    execute(prompt: string, model: string): string {
      const result = exec('claude', ['-p', '--model', model], prompt);
      return result.trim();
    },
  };
}
