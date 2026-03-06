import { describe, it, expect } from 'vitest';
import { createClaudeExecutor } from '../../src/utils/claude-executor.js';
import type { ClaudeExecutor } from '../../src/utils/claude-executor.js';

describe('createClaudeExecutor', () => {
  it('calls claude CLI with correct arguments and pipes prompt via stdin', () => {
    let capturedCommand = '';
    let capturedArgs: string[] = [];
    let capturedInput: string | undefined;

    const executor = createClaudeExecutor({
      execFn: (cmd, args, input) => {
        capturedCommand = cmd;
        capturedArgs = args;
        capturedInput = input;
        return 'mock response';
      },
    });

    executor.execute('Summarize this code', 'haiku');

    expect(capturedCommand).toBe('claude');
    expect(capturedArgs).toEqual(['-p', '--model', 'haiku']);
    expect(capturedInput).toBe('Summarize this code');
  });

  it('returns trimmed response from claude CLI', () => {
    const executor = createClaudeExecutor({
      execFn: () => '  This is the summary.\n\n',
    });

    const result = executor.execute('prompt', 'haiku');
    expect(result).toBe('This is the summary.');
  });

  it('passes the model parameter correctly', () => {
    let capturedArgs: string[] = [];

    const executor = createClaudeExecutor({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return 'response';
      },
    });

    executor.execute('prompt', 'sonnet');
    expect(capturedArgs).toEqual(['-p', '--model', 'sonnet']);

    executor.execute('prompt', 'opus');
    expect(capturedArgs).toEqual(['-p', '--model', 'opus']);
  });

  it('throws when the CLI call fails', () => {
    const executor = createClaudeExecutor({
      execFn: () => {
        throw new Error('claude: command not found');
      },
    });

    expect(() => executor.execute('prompt', 'haiku')).toThrow('claude: command not found');
  });

  it('handles multi-line prompts via stdin', () => {
    let capturedInput: string | undefined;

    const executor = createClaudeExecutor({
      execFn: (_cmd, _args, input) => {
        capturedInput = input;
        return 'response';
      },
    });

    const multiLinePrompt = 'Line 1\nLine 2\nLine 3';
    executor.execute(multiLinePrompt, 'haiku');
    expect(capturedInput).toBe(multiLinePrompt);
  });

  it('handles empty response from CLI', () => {
    const executor = createClaudeExecutor({
      execFn: () => '',
    });

    const result = executor.execute('prompt', 'haiku');
    expect(result).toBe('');
  });
});
