import { describe, it, expect, vi } from 'vitest';
import { createResolverRunner, type ResolverRunnerDeps, type ResolverResult } from '../src/resolvers.js';
import type { PipelineConfig, ResolverContext, ResolverStageInput } from 'kanban-cli';
import { ResolverRegistry } from 'kanban-cli';
import type { FrontmatterData } from '../src/locking.js';
import type { ExitGateRunner, ExitGateResult } from '../src/exit-gates.js';

/** A minimal pipeline config with one resolver state ("PR Created" -> "pr-status") */
function makePipelineConfig(): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'Design', skill: 'design', transitions_to: ['Implementation'] },
        { name: 'Implementation', status: 'Implementation', skill: 'implement', transitions_to: ['PR Created'] },
        { name: 'PR Created', status: 'PR Created', resolver: 'pr-status', transitions_to: ['Complete'] },
      ],
    },
  };
}

/** Build a mock resolver registry with configurable resolver functions. */
function makeRegistry(resolvers: Record<string, (stage: ResolverStageInput, ctx: ResolverContext) => string | null>): ResolverRegistry {
  const registry = new ResolverRegistry();
  for (const [name, fn] of Object.entries(resolvers)) {
    registry.register(name, fn);
  }
  return registry;
}

/** Build a mock exit gate runner. */
function makeExitGateRunner(result?: Partial<ExitGateResult>): ExitGateRunner & { run: ReturnType<typeof vi.fn> } {
  const defaultResult: ExitGateResult = {
    statusChanged: true,
    statusBefore: '',
    statusAfter: '',
    ticketUpdated: true,
    epicUpdated: true,
    ticketCompleted: false,
    epicCompleted: false,
    syncResult: { success: true },
    ...result,
  };
  return {
    run: vi.fn(async () => defaultResult),
  };
}

/** Build a mock frontmatter store keyed by file path. */
function makeFrontmatterStore(entries: Record<string, FrontmatterData>) {
  const store: Record<string, FrontmatterData> = {};
  for (const [key, value] of Object.entries(entries)) {
    store[key] = structuredClone(value);
  }

  return {
    readFrontmatter: vi.fn(async (filePath: string) => {
      const entry = store[filePath];
      if (!entry) throw new Error(`ENOENT: ${filePath}`);
      return structuredClone(entry);
    }),
    writeFrontmatter: vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
      store[filePath] = structuredClone({ data, content });
    }),
    store,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const REPO_PATH = '/repo';
const CONTEXT: ResolverContext = { env: {} };

describe('createResolverRunner', () => {
  it('returns empty array when no stage files found', async () => {
    const registry = makeRegistry({ 'pr-status': () => null });
    const exitGateRunner = makeExitGateRunner();
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      discoverStageFiles: vi.fn(async () => []),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toEqual([]);
    expect(exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('skips stages with session_active === true', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001', session_active: true },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toEqual([]);
    expect(exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('skips stages not in resolver states', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'Design', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toEqual([]);
    expect(exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('executes resolver and records null result (no transition)', async () => {
    const registry = makeRegistry({ 'pr-status': () => null });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001', pr_url: 'https://github.com/org/repo/pull/42' },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      resolverName: 'pr-status',
      previousStatus: 'PR Created',
      newStatus: null,
      propagated: false,
    });
    expect(fm.writeFrontmatter).not.toHaveBeenCalled();
    expect(exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('executes resolver, updates stage frontmatter, calls exit gate on transition', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001', pr_url: 'https://github.com/org/repo/pull/42' },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      resolverName: 'pr-status',
      previousStatus: 'PR Created',
      newStatus: 'Complete',
      propagated: true,
    });

    // Check frontmatter was updated
    expect(fm.writeFrontmatter).toHaveBeenCalledWith(
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
      expect.objectContaining({ status: 'Complete' }),
      '# Stage\n',
    );

    // Check exit gate was called with correct WorkerInfo
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
    const workerInfoArg = exitGateRunner.run.mock.calls[0][0];
    expect(workerInfoArg.stageId).toBe('STAGE-001');
    expect(workerInfoArg.stageFilePath).toBe('/repo/epics/EPIC-001/TICKET-001/STAGE-001.md');
    expect(workerInfoArg.statusBefore).toBe('PR Created');
    expect(exitGateRunner.run.mock.calls[0][1]).toBe(REPO_PATH);
    expect(exitGateRunner.run.mock.calls[0][2]).toBe('Complete');
  });

  it('handles resolver execution error gracefully (logs error, continues)', async () => {
    const registry = new ResolverRegistry();
    registry.register('pr-status', () => { throw new Error('GitHub API timeout'); });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
      '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md': {
        data: { id: 'STAGE-002', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 2\n',
      },
    });
    const logger = makeLogger();

    // Register a second resolver call that succeeds (to test continuation)
    // Since both stages use the same resolver, override: register a function
    // that throws on first call, returns null on second
    let callCount = 0;
    const throwingRegistry = new ResolverRegistry();
    throwingRegistry.register('pr-status', () => {
      callCount++;
      if (callCount === 1) throw new Error('GitHub API timeout');
      return null;
    });

    const runner = createResolverRunner(makePipelineConfig(), {
      registry: throwingRegistry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => [
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
      ]),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    // First stage errored (skipped), second stage processed
    expect(results).toHaveLength(1);
    expect(results[0].stageId).toBe('STAGE-002');
    expect(results[0].newStatus).toBeNull();

    // Error was logged for first stage
    expect(logger.error).toHaveBeenCalledWith(
      'Resolver execution failed',
      expect.objectContaining({
        stageId: 'STAGE-001',
        resolverName: 'pr-status',
        error: 'GitHub API timeout',
      }),
    );
  });

  it('handles stage file read failure gracefully', async () => {
    const registry = makeRegistry({ 'pr-status': () => null });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      // Only STAGE-002 exists; STAGE-001 will fail to read
      '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md': {
        data: { id: 'STAGE-002', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 2\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => [
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
      ]),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    // First stage skipped due to read failure, second processed
    expect(results).toHaveLength(1);
    expect(results[0].stageId).toBe('STAGE-002');

    // Warning was logged for first stage
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to read stage file',
      expect.objectContaining({
        stageFilePath: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
      }),
    );
  });

  it('processes multiple stages in sequence', async () => {
    let resolverCallOrder: string[] = [];
    const registry = new ResolverRegistry();
    registry.register('pr-status', (stage: ResolverStageInput) => {
      resolverCallOrder.push(stage.id);
      // First stage transitions, second stays
      if (stage.id === 'STAGE-001') return 'Complete';
      return null;
    });

    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 1\n',
      },
      '/repo/epics/EPIC-002/TICKET-002/STAGE-002.md': {
        data: { id: 'STAGE-002', status: 'PR Created', ticket: 'TICKET-002', epic: 'EPIC-002' },
        content: '# Stage 2\n',
      },
      '/repo/epics/EPIC-003/TICKET-003/STAGE-003.md': {
        data: { id: 'STAGE-003', status: 'Design', ticket: 'TICKET-003', epic: 'EPIC-003' },
        content: '# Stage 3\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => [
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        '/repo/epics/EPIC-002/TICKET-002/STAGE-002.md',
        '/repo/epics/EPIC-003/TICKET-003/STAGE-003.md',
      ]),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    // STAGE-003 is in "Design" (skill state), not a resolver state -> skipped entirely (no result)
    // STAGE-001 transitioned, STAGE-002 returned null
    expect(results).toHaveLength(2);

    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      resolverName: 'pr-status',
      previousStatus: 'PR Created',
      newStatus: 'Complete',
      propagated: true,
    });

    expect(results[1]).toEqual({
      stageId: 'STAGE-002',
      resolverName: 'pr-status',
      previousStatus: 'PR Created',
      newStatus: null,
      propagated: false,
    });

    // Resolver was called in order for the two resolver-state stages
    expect(resolverCallOrder).toEqual(['STAGE-001', 'STAGE-002']);

    // Exit gate called only for the transitioned stage
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
  });

  it('handles exit gate failure gracefully (marks propagated: false)', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();
    exitGateRunner.run = vi.fn(async () => { throw new Error('Sync failed'); });

    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      resolverName: 'pr-status',
      previousStatus: 'PR Created',
      newStatus: 'Complete',
      propagated: false,
    });

    // Frontmatter was still updated
    expect(fm.writeFrontmatter).toHaveBeenCalled();

    // Error was logged
    expect(logger.error).toHaveBeenCalledWith(
      'Exit gate propagation failed',
      expect.objectContaining({
        stageId: 'STAGE-001',
        resolverName: 'pr-status',
        error: 'Sync failed',
      }),
    );
  });

  it('returns empty array when discoverStageFiles throws', async () => {
    const registry = makeRegistry({ 'pr-status': () => null });
    const exitGateRunner = makeExitGateRunner();
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      discoverStageFiles: vi.fn(async () => { throw new Error('Permission denied'); }),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    expect(results).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to discover stage files',
      expect.objectContaining({
        repoPath: REPO_PATH,
        error: 'Permission denied',
      }),
    );
  });

  it('skips stage and continues when writeFrontmatter throws', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();

    let writeCallCount = 0;
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 1\n',
      },
      '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md': {
        data: { id: 'STAGE-002', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 2\n',
      },
    });

    // Override writeFrontmatter to throw on first call, succeed on second
    fm.writeFrontmatter = vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
      writeCallCount++;
      if (writeCallCount === 1) throw new Error('Disk full');
      fm.store[filePath] = structuredClone({ data, content });
    });

    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => [
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
      ]),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    // First stage's writeFrontmatter failed -> skipped (no result entry for it)
    // Second stage succeeded -> included in results
    expect(results).toHaveLength(1);
    expect(results[0].stageId).toBe('STAGE-002');
    expect(results[0].newStatus).toBe('Complete');
    expect(results[0].propagated).toBe(true);

    // Error was logged for the failed write
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to write updated status',
      expect.objectContaining({
        stageId: 'STAGE-001',
        resolverName: 'pr-status',
        newStatus: 'Complete',
        error: 'Disk full',
      }),
    );

    // Exit gate was NOT called for the failed stage, only for the successful one
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
    expect(exitGateRunner.run.mock.calls[0][0].stageId).toBe('STAGE-002');
  });

  it('skips stages missing id or status fields and logs warning', async () => {
    const registry = makeRegistry({ 'pr-status': () => 'Complete' });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { status: 'PR Created', ticket: 'TICKET-001' }, // missing id
        content: '# Stage 1\n',
      },
      '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md': {
        data: { id: 'STAGE-002', ticket: 'TICKET-001' }, // missing status
        content: '# Stage 2\n',
      },
      '/repo/epics/EPIC-001/TICKET-001/STAGE-003.md': {
        data: { id: 'STAGE-003', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 3\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => [
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
        '/repo/epics/EPIC-001/TICKET-001/STAGE-003.md',
      ]),
      logger,
    });

    const results = await runner.checkAll(REPO_PATH, CONTEXT);

    // Only STAGE-003 should be processed
    expect(results).toHaveLength(1);
    expect(results[0].stageId).toBe('STAGE-003');
    expect(results[0].newStatus).toBe('Complete');

    // Warnings logged for both malformed stages
    expect(logger.warn).toHaveBeenCalledWith(
      'Stage file missing id or status',
      expect.objectContaining({ stageFilePath: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Stage file missing id or status',
      expect.objectContaining({ stageFilePath: '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md' }),
    );

    // Exit gate called only for the valid stage
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
  });

  it('passes correct ResolverStageInput fields to resolver', async () => {
    let capturedInput: ResolverStageInput | null = null;
    const registry = new ResolverRegistry();
    registry.register('pr-status', (stage: ResolverStageInput) => {
      capturedInput = stage;
      return null;
    });

    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: {
          id: 'STAGE-001',
          status: 'PR Created',
          ticket: 'TICKET-001',
          epic: 'EPIC-001',
          pr_url: 'https://github.com/org/repo/pull/42',
          pr_number: 42,
          worktree_branch: 'feature/STAGE-001',
          refinement_type: ['split'],
        },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const runner = createResolverRunner(makePipelineConfig(), {
      registry,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      discoverStageFiles: vi.fn(async () => ['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md']),
      logger,
    });

    await runner.checkAll(REPO_PATH, CONTEXT);

    expect(capturedInput).not.toBeNull();
    expect(capturedInput!.id).toBe('STAGE-001');
    expect(capturedInput!.status).toBe('PR Created');
    expect(capturedInput!.ticket_id).toBe('TICKET-001');
    expect(capturedInput!.epic_id).toBe('EPIC-001');
    expect(capturedInput!.pr_url).toBe('https://github.com/org/repo/pull/42');
    expect(capturedInput!.pr_number).toBe(42);
    expect(capturedInput!.worktree_branch).toBe('feature/STAGE-001');
    expect(capturedInput!.refinement_type).toEqual(['split']);
  });
});
