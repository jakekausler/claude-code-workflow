import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createJiraExecutor, JiraScriptError, JiraTimeoutError, JiraValidationError } from '../../src/jira/executor.js';
import type { JiraConfig } from '../../src/types/pipeline.js';

// Process-spawning tests can be slow under concurrent load
vi.setConfig({ testTimeout: 15_000 });

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures/jira');
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Helper: create a config pointing to fixture scripts */
function fixtureConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    reading_script: path.join(FIXTURES_DIR, 'mock-reader.ts'),
    writing_script: path.join(FIXTURES_DIR, 'mock-writer.ts'),
    ...overrides,
  };
}

describe('createJiraExecutor', () => {
  // ─── canRead / canWrite ───────────────────────────────────────────────

  describe('canRead', () => {
    it('returns true when reading_script is set', () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      expect(executor.canRead()).toBe(true);
    });

    it('returns false when reading_script is null', () => {
      const executor = createJiraExecutor(fixtureConfig({ reading_script: null }), REPO_ROOT);
      expect(executor.canRead()).toBe(false);
    });

    it('returns false when reading_script is undefined', () => {
      const executor = createJiraExecutor(fixtureConfig({ reading_script: undefined }), REPO_ROOT);
      expect(executor.canRead()).toBe(false);
    });
  });

  describe('canWrite', () => {
    it('returns true when writing_script is set', () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      expect(executor.canWrite()).toBe(true);
    });

    it('returns false when writing_script is null', () => {
      const executor = createJiraExecutor(fixtureConfig({ writing_script: null }), REPO_ROOT);
      expect(executor.canWrite()).toBe(false);
    });

    it('returns false when writing_script is undefined', () => {
      const executor = createJiraExecutor(fixtureConfig({ writing_script: undefined }), REPO_ROOT);
      expect(executor.canWrite()).toBe(false);
    });
  });

  // ─── Read method without config ───────────────────────────────────────

  describe('calling read method when reading_script is not configured', () => {
    it('getTicket throws descriptive error', async () => {
      const executor = createJiraExecutor(fixtureConfig({ reading_script: null }), REPO_ROOT);
      await expect(executor.getTicket('PROJ-1')).rejects.toThrow(
        'Jira reading not configured: reading_script is not set in pipeline config',
      );
    });

    it('searchTickets throws descriptive error', async () => {
      const executor = createJiraExecutor(fixtureConfig({ reading_script: null }), REPO_ROOT);
      await expect(executor.searchTickets('project = PROJ')).rejects.toThrow(
        'Jira reading not configured: reading_script is not set in pipeline config',
      );
    });
  });

  // ─── Write method without config ──────────────────────────────────────

  describe('calling write method when writing_script is not configured', () => {
    it('transitionTicket throws descriptive error', async () => {
      const executor = createJiraExecutor(fixtureConfig({ writing_script: null }), REPO_ROOT);
      await expect(executor.transitionTicket('PROJ-1', 'Done')).rejects.toThrow(
        'Jira writing not configured: writing_script is not set in pipeline config',
      );
    });

    it('assignTicket throws descriptive error', async () => {
      const executor = createJiraExecutor(fixtureConfig({ writing_script: null }), REPO_ROOT);
      await expect(executor.assignTicket('PROJ-1', 'alice')).rejects.toThrow(
        'Jira writing not configured: writing_script is not set in pipeline config',
      );
    });

    it('addComment throws descriptive error', async () => {
      const executor = createJiraExecutor(fixtureConfig({ writing_script: null }), REPO_ROOT);
      await expect(executor.addComment('PROJ-1', 'hello')).rejects.toThrow(
        'Jira writing not configured: writing_script is not set in pipeline config',
      );
    });
  });

  // ─── Script path resolution ───────────────────────────────────────────

  describe('script path resolution', () => {
    it('absolute path is used as-is', async () => {
      const absPath = path.join(FIXTURES_DIR, 'mock-reader.ts');
      const executor = createJiraExecutor({ reading_script: absPath }, REPO_ROOT);
      const result = await executor.getTicket('PROJ-5');
      expect(result.key).toBe('PROJ-5');
    });

    it('relative path is resolved from repoRoot', async () => {
      const relativePath = path.relative(REPO_ROOT, path.join(FIXTURES_DIR, 'mock-reader.ts'));
      const executor = createJiraExecutor({ reading_script: relativePath }, REPO_ROOT);
      const result = await executor.getTicket('PROJ-6');
      expect(result.key).toBe('PROJ-6');
    });
  });

  // ─── getTicket ────────────────────────────────────────────────────────

  describe('getTicket', () => {
    it('sends correct JSON stdin and returns typed result', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.getTicket('PROJ-42');

      expect(result.key).toBe('PROJ-42');
      expect(result.summary).toBe('Summary for PROJ-42');
      expect(result.description).toBe('Description for PROJ-42');
      expect(result.status).toBe('In Progress');
      expect(result.type).toBe('Story');
      expect(result.parent).toBe('PROJ-1');
      expect(result.assignee).toBe('alice');
      expect(result.labels).toEqual(['backend', 'priority-high']);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].author).toBe('bob');
    });
  });

  // ─── searchTickets ────────────────────────────────────────────────────

  describe('searchTickets', () => {
    it('sends correct JSON stdin with default max_results', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.searchTickets('project = PROJ');

      expect(result.tickets).toHaveLength(2);
      expect(result.tickets[0].key).toBe('PROJ-10');
      expect(result.tickets[1].key).toBe('PROJ-11');
    });

    it('sends correct JSON stdin with custom max_results', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.searchTickets('project = PROJ', 10);
      expect(result.tickets).toHaveLength(2);
    });
  });

  // ─── transitionTicket ─────────────────────────────────────────────────

  describe('transitionTicket', () => {
    it('sends correct JSON stdin and returns typed result', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.transitionTicket('PROJ-7', 'In Review');

      expect(result.key).toBe('PROJ-7');
      expect(result.success).toBe(true);
      expect(result.previous_status).toBe('To Do');
      expect(result.new_status).toBe('In Review');
    });
  });

  // ─── assignTicket ─────────────────────────────────────────────────────

  describe('assignTicket', () => {
    it('sends correct JSON stdin and returns typed result', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.assignTicket('PROJ-8', 'charlie');

      expect(result.key).toBe('PROJ-8');
      expect(result.success).toBe(true);
    });

    it('handles null assignee for unassignment', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.assignTicket('PROJ-9', null);

      expect(result.key).toBe('PROJ-9');
      expect(result.success).toBe(true);
    });
  });

  // ─── addComment ───────────────────────────────────────────────────────

  describe('addComment', () => {
    it('sends correct JSON stdin and returns typed result', async () => {
      const executor = createJiraExecutor(fixtureConfig(), REPO_ROOT);
      const result = await executor.addComment('PROJ-3', 'This is a comment');

      expect(result.key).toBe('PROJ-3');
      expect(result.success).toBe(true);
      expect(result.comment_id).toBe('12345');
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('script that exits non-zero with JSON stderr throws JiraScriptError', async () => {
      const executor = createJiraExecutor(
        fixtureConfig({ reading_script: path.join(FIXTURES_DIR, 'mock-error.ts') }),
        REPO_ROOT,
      );

      try {
        await executor.getTicket('PROJ-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraScriptError);
        const scriptErr = err as JiraScriptError;
        expect(scriptErr.message).toBe('Authentication failed: invalid API token');
        expect(scriptErr.exitCode).toBe(1);
      }
    });

    it('script that exits non-zero with raw stderr throws JiraScriptError', async () => {
      const executor = createJiraExecutor(
        fixtureConfig({ reading_script: path.join(FIXTURES_DIR, 'mock-raw-error.ts') }),
        REPO_ROOT,
      );

      try {
        await executor.getTicket('PROJ-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraScriptError);
        const scriptErr = err as JiraScriptError;
        expect(scriptErr.message).toBe('Something went terribly wrong');
        expect(scriptErr.exitCode).toBe(2);
      }
    });

    it('script that outputs invalid JSON throws JiraValidationError', async () => {
      const executor = createJiraExecutor(
        fixtureConfig({ reading_script: path.join(FIXTURES_DIR, 'mock-bad-json.ts') }),
        REPO_ROOT,
      );

      try {
        await executor.getTicket('PROJ-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraValidationError);
        expect((err as JiraValidationError).message).toContain('not valid JSON');
      }
    });

    it('script that outputs valid JSON but wrong schema throws JiraValidationError', async () => {
      const executor = createJiraExecutor(
        fixtureConfig({ reading_script: path.join(FIXTURES_DIR, 'mock-invalid-schema.ts') }),
        REPO_ROOT,
      );

      try {
        await executor.getTicket('PROJ-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraValidationError);
        expect((err as JiraValidationError).message).toContain('schema validation');
      }
    });

    it('script that times out throws JiraTimeoutError', async () => {
      const executor = createJiraExecutor(
        fixtureConfig({ reading_script: path.join(FIXTURES_DIR, 'mock-timeout.ts') }),
        REPO_ROOT,
        { timeoutMs: 2000 },
      );

      try {
        await executor.getTicket('PROJ-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraTimeoutError);
        const timeoutErr = err as JiraTimeoutError;
        expect(timeoutErr.timeoutMs).toBe(2000);
        expect(timeoutErr.message).toContain('timed out after 2000ms');
      }
    });
  });

  // ─── Error class properties ───────────────────────────────────────────

  describe('error classes', () => {
    it('JiraTimeoutError contains script path and timeout', () => {
      const err = new JiraTimeoutError('/path/to/script.ts', 5000);
      expect(err.message).toBe('Jira script timed out after 5000ms: /path/to/script.ts');
      expect(err.scriptPath).toBe('/path/to/script.ts');
      expect(err.timeoutMs).toBe(5000);
      expect(err.name).toBe('JiraTimeoutError');
    });

    it('JiraScriptError contains exit code and stderr', () => {
      const err = new JiraScriptError('Something failed', 1, 'stderr output');
      expect(err.message).toBe('Something failed');
      expect(err.exitCode).toBe(1);
      expect(err.stderr).toBe('stderr output');
      expect(err.name).toBe('JiraScriptError');
    });

    it('JiraValidationError contains raw output', () => {
      const err = new JiraValidationError('Schema mismatch', '{"bad":"data"}');
      expect(err.message).toBe('Schema mismatch');
      expect(err.rawOutput).toBe('{"bad":"data"}');
      expect(err.name).toBe('JiraValidationError');
    });
  });
});
