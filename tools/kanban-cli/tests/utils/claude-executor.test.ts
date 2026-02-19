import { describe, it, expect } from 'vitest';
import { createClaudeExecutor } from '../../src/utils/claude-executor.js';
import type { ClaudeExecutor } from '../../src/utils/claude-executor.js';

describe('createClaudeExecutor', () => {
  it('calls claude CLI with correct arguments', () => {
    let capturedCommand = '';
    let capturedArgs: string[] = [];

    const executor = createClaudeExecutor({
      execFn: (cmd, args) => {
        capturedCommand = cmd;
        capturedArgs = args;
        return 'mock response';
      },
    });

    executor.execute('Summarize this code', 'haiku');

    expect(capturedCommand).toBe('claude');
    expect(capturedArgs).toEqual(['-p', '--model', 'haiku', 'Summarize this code']);
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
    expect(capturedArgs[2]).toBe('sonnet');

    executor.execute('prompt', 'opus');
    expect(capturedArgs[2]).toBe('opus');
  });

  it('throws when the CLI call fails', () => {
    const executor = createClaudeExecutor({
      execFn: () => {
        throw new Error('claude: command not found');
      },
    });

    expect(() => executor.execute('prompt', 'haiku')).toThrow('claude: command not found');
  });

  it('handles multi-line prompts', () => {
    let capturedArgs: string[] = [];

    const executor = createClaudeExecutor({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return 'response';
      },
    });

    const multiLinePrompt = 'Line 1\nLine 2\nLine 3';
    executor.execute(multiLinePrompt, 'haiku');
    expect(capturedArgs[3]).toBe(multiLinePrompt);
  });

  it('handles empty response from CLI', () => {
    const executor = createClaudeExecutor({
      execFn: () => '',
    });

    const result = executor.execute('prompt', 'haiku');
    expect(result).toBe('');
  });
});
