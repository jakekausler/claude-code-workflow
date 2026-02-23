import { describe, it, expect, vi } from 'vitest';
import type { PipelineConfig } from 'kanban-cli';
import type { FrontmatterData, LockerDeps } from '../src/locking.js';
import type { SessionLoggerLike, SpawnOptions } from '../src/session.js';
import { createMockSessionExecutor, type MockSessionDeps } from '../src/mock-session.js';

/** Build a default PipelineConfig for testing. */
function makePipelineConfig(): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Implement'] },
        { name: 'Implement', skill: 'phase-implement', status: 'Implement', transitions_to: ['Review'] },
        { name: 'Review', skill: 'phase-review', status: 'Review', transitions_to: ['Done'] },
        { name: 'Terminal', skill: 'phase-terminal', status: 'Terminal', transitions_to: [] },
      ],
    },
  };
}

/** Build default SpawnOptions for testing. */
function makeSpawnOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    stageId: 'STAGE-001',
    stageFilePath: '/repo/epics/epic-001/tickets/ticket-001/stages/stage-001.md',
    skillName: 'phase-design',
    worktreePath: '/repo/.worktrees/worktree-1',
    worktreeIndex: 1,
    model: 'sonnet',
    workflowEnv: {},
    ...overrides,
  };
}

/** Build a mock session logger. */
function makeLogger(): SessionLoggerLike & { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn() };
}

/** Build mock deps with controllable read/write frontmatter. */
function makeMockDeps(
  frontmatter: FrontmatterData,
  overrides: Partial<MockSessionDeps> = {},
): MockSessionDeps & {
  readFrontmatter: ReturnType<typeof vi.fn>;
  writeFrontmatter: ReturnType<typeof vi.fn>;
} {
  const readFrontmatter = vi.fn(async () => ({
    data: { ...frontmatter.data },
    content: frontmatter.content,
  }));
  const writeFrontmatter = vi.fn(async () => {});

  return {
    readFrontmatter,
    writeFrontmatter,
    pipelineConfig: makePipelineConfig(),
    delayMs: 0,  // no delay in tests
    ...overrides,
  };
}

describe('createMockSessionExecutor', () => {
  describe('spawn', () => {
    it('advances status to first transition', async () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions(), logger);

      expect(deps.writeFrontmatter).toHaveBeenCalledTimes(1);
      const [, writtenData] = deps.writeFrontmatter.mock.calls[0];
      expect(writtenData.status).toBe('Implement');
    });

    it('writes new status to frontmatter', async () => {
      const deps = makeMockDeps({ data: { status: 'Implement' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions(), logger);

      expect(deps.writeFrontmatter).toHaveBeenCalledWith(
        makeSpawnOptions().stageFilePath,
        expect.objectContaining({ status: 'Review' }),
        'body',
      );
    });

    it('preserves other frontmatter fields', async () => {
      const deps = makeMockDeps({
        data: { status: 'Design', title: 'My Stage', priority: 'high', session_active: true },
        content: 'body content',
      });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions(), logger);

      const [, writtenData, writtenContent] = deps.writeFrontmatter.mock.calls[0];
      expect(writtenData.title).toBe('My Stage');
      expect(writtenData.priority).toBe('high');
      expect(writtenData.session_active).toBe(true);
      expect(writtenContent).toBe('body content');
    });

    it('logs mock advancement message', async () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions({ stageId: 'STAGE-042' }), logger);

      expect(logger.write).toHaveBeenCalledWith(
        '[MOCK] Advancing stage STAGE-042 from Design to Implement\n',
      );
    });

    it('returns exitCode 0 and correct duration', async () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      deps.delayMs = 100;
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      const result = await executor.spawn(makeSpawnOptions(), logger);

      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBe(100);
    });

    it('handles stage with no transitions (stays in current status)', async () => {
      const deps = makeMockDeps({ data: { status: 'Terminal' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions({ stageId: 'STAGE-999' }), logger);

      // Should NOT call writeFrontmatter since there are no transitions
      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
      expect(logger.write).toHaveBeenCalledWith(
        '[MOCK] Stage STAGE-999 has no transitions from Terminal\n',
      );
    });

    it('handles stage with unknown status', async () => {
      const deps = makeMockDeps({ data: { status: 'UnknownPhase' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions(), logger);

      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
    });

    it('handles stage with no status field', async () => {
      const deps = makeMockDeps({ data: {}, content: 'body' });
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      await executor.spawn(makeSpawnOptions(), logger);

      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
    });

    it('uses default delayMs of 500 when not specified', async () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      delete (deps as Partial<MockSessionDeps>).delayMs;
      const executor = createMockSessionExecutor(deps);
      const logger = makeLogger();

      const result = await executor.spawn(makeSpawnOptions(), logger);

      expect(result.durationMs).toBe(500);
    });
  });

  describe('getActiveSessions', () => {
    it('returns empty array', () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);

      expect(executor.getActiveSessions()).toEqual([]);
    });
  });

  describe('killAll', () => {
    it('is a no-op (does not throw)', () => {
      const deps = makeMockDeps({ data: { status: 'Design' }, content: 'body' });
      const executor = createMockSessionExecutor(deps);

      // Should not throw
      executor.killAll();
      executor.killAll('SIGTERM');
    });
  });
});
