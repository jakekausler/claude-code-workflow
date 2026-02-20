import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Process-spawning tests can be slow
vi.setConfig({ testTimeout: 15_000 });

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '../../../scripts/jira');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const READER_SCRIPT = path.join(SCRIPTS_DIR, 'default-jira-reader.ts');
const WRITER_SCRIPT = path.join(SCRIPTS_DIR, 'default-jira-writer.ts');

/**
 * Spawn a script with JSON input on stdin, returning stdout, stderr, and exit code.
 */
function runScript(
  scriptPath: string,
  stdinData: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

// ─── Reader script tests ─────────────────────────────────────────────────────

describe('default-jira-reader.ts', () => {
  describe('TypeScript parsing', () => {
    it('can be parsed by tsx without syntax errors (empty stdin yields error)', async () => {
      const result = await runScript(READER_SCRIPT, '');

      // Script should exit non-zero due to empty stdin, but that proves it parsed
      expect(result.exitCode).not.toBe(0);

      // Verify the error is our structured JSON error (proves the script ran)
      const errObj = JSON.parse(result.stderr);
      expect(errObj).toHaveProperty('error');
      expect(errObj).toHaveProperty('code');
    });
  });

  describe('invalid operation', () => {
    it('returns error for unknown operation', async () => {
      const result = await runScript(
        READER_SCRIPT,
        JSON.stringify({ operation: 'do-something-weird' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Unknown operation');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('missing stdin', () => {
    it('returns error for empty stdin', async () => {
      const result = await runScript(READER_SCRIPT, '');

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Empty stdin');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('invalid JSON', () => {
    it('returns error for non-JSON stdin', async () => {
      const result = await runScript(READER_SCRIPT, 'not json at all');

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Invalid JSON');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('missing operation field', () => {
    it('returns error when operation is missing', async () => {
      const result = await runScript(
        READER_SCRIPT,
        JSON.stringify({ key: 'PROJ-1' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('operation');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('get-ticket validation', () => {
    it('returns error when key is missing for get-ticket', async () => {
      const result = await runScript(
        READER_SCRIPT,
        JSON.stringify({ operation: 'get-ticket' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });

    it('returns error for invalid ticket key format', async () => {
      const result = await runScript(
        READER_SCRIPT,
        JSON.stringify({ operation: 'get-ticket', key: 'badkey' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Invalid ticket key');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('search-tickets validation', () => {
    it('returns error when jql is missing for search-tickets', async () => {
      const result = await runScript(
        READER_SCRIPT,
        JSON.stringify({ operation: 'search-tickets' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });
});

// ─── Writer script tests ─────────────────────────────────────────────────────

describe('default-jira-writer.ts', () => {
  describe('TypeScript parsing', () => {
    it('can be parsed by tsx without syntax errors (empty stdin yields error)', async () => {
      const result = await runScript(WRITER_SCRIPT, '');

      // Script should exit non-zero due to empty stdin, but that proves it parsed
      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj).toHaveProperty('error');
      expect(errObj).toHaveProperty('code');
    });
  });

  describe('invalid operation', () => {
    it('returns error for unknown operation', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'destroy-everything' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Unknown operation');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('missing stdin', () => {
    it('returns error for empty stdin', async () => {
      const result = await runScript(WRITER_SCRIPT, '');

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Empty stdin');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('invalid JSON', () => {
    it('returns error for non-JSON stdin', async () => {
      const result = await runScript(WRITER_SCRIPT, '{broken json');

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('Invalid JSON');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('missing operation field', () => {
    it('returns error when operation is missing', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ key: 'PROJ-1' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.error).toContain('operation');
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('assign-ticket validation', () => {
    it('returns error when key is missing for assign-ticket', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'assign-ticket', assignee: 'alice' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('add-comment validation', () => {
    it('returns error when key is missing for add-comment', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'add-comment', body: 'hello' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });

    it('returns error when body is missing for add-comment', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'add-comment', key: 'PROJ-1' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });

  describe('transition-ticket validation', () => {
    it('returns error when key is missing for transition-ticket', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'transition-ticket', target_status: 'Done' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });

    it('returns error when target_status is missing for transition-ticket', async () => {
      const result = await runScript(
        WRITER_SCRIPT,
        JSON.stringify({ operation: 'transition-ticket', key: 'PROJ-1' }),
      );

      expect(result.exitCode).not.toBe(0);

      const errObj = JSON.parse(result.stderr);
      expect(errObj.code).toBe('INVALID_INPUT');
    });
  });
});
