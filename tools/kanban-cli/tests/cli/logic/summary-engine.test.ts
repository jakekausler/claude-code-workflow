import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../../src/db/database.js';
import { RepoRepository, SummaryRepository } from '../../../src/db/repositories/index.js';
import { SummaryEngine, computeHash } from '../../../src/cli/logic/summary-engine.js';
import type {
  StageSummaryInput,
  TicketSummaryInput,
  EpicSummaryInput,
} from '../../../src/cli/logic/summary-engine.js';
import type { ClaudeExecutor } from '../../../src/utils/claude-executor.js';

// ---------- Test helpers ----------

function makeStageInput(overrides: Partial<StageSummaryInput> = {}): StageSummaryInput {
  return {
    id: 'STAGE-001-001-001',
    title: 'Login Form UI',
    status: 'Complete',
    file_content: '---\nid: STAGE-001-001-001\ntitle: Login Form UI\n---\n## Overview\nBuild login form.\n',
    ...overrides,
  };
}

function makeTicketInput(overrides: Partial<TicketSummaryInput> = {}): TicketSummaryInput {
  return {
    id: 'TICKET-001-001',
    title: 'Login Flow',
    status: 'In Progress',
    stages: [
      makeStageInput({ id: 'STAGE-001-001-001', title: 'Login Form UI' }),
      makeStageInput({ id: 'STAGE-001-001-002', title: 'Auth API', file_content: '---\nid: STAGE-001-001-002\n---\nAPI endpoints.' }),
    ],
    ...overrides,
  };
}

function makeEpicInput(overrides: Partial<EpicSummaryInput> = {}): EpicSummaryInput {
  return {
    id: 'EPIC-001',
    title: 'User Authentication',
    status: 'In Progress',
    tickets: [makeTicketInput()],
    ...overrides,
  };
}

function createMockExecutor(responseMap?: Map<string, string>): ClaudeExecutor & { calls: Array<{ prompt: string; model: string }> } {
  const calls: Array<{ prompt: string; model: string }> = [];
  return {
    calls,
    execute(prompt: string, model: string): string {
      calls.push({ prompt, model });
      if (responseMap) {
        for (const [key, value] of responseMap) {
          if (prompt.includes(key)) return value;
        }
      }
      return `Mock summary for prompt containing model=${model}`;
    },
  };
}

describe('computeHash', () => {
  it('produces a hex string', () => {
    const hash = computeHash('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces same hash for same content', () => {
    expect(computeHash('test')).toBe(computeHash('test'));
  });

  it('produces different hashes for different content', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });
});

describe('SummaryEngine', () => {
  let tmpDir: string;
  let db: KanbanDatabase;
  let summaryRepo: SummaryRepository;
  let repoId: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-summary-engine-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
    summaryRepo = new SummaryRepository(db);
    const repoRepo = new RepoRepository(db);
    repoId = repoRepo.upsert('/test/repo', 'test-repo');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Stage summarization ────────────────────────────────────

  describe('summarizeStage', () => {
    it('calls executor with stage prompt and returns summary', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const result = engine.summarizeStage(makeStageInput());

      expect(result.id).toBe('STAGE-001-001-001');
      expect(result.type).toBe('stage');
      expect(result.title).toBe('Login Form UI');
      expect(result.summary).toContain('Mock summary');
      expect(result.cached).toBe(false);
      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0].model).toBe('haiku'); // default model
    });

    it('uses specified model instead of default', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        model: 'sonnet',
      });

      engine.summarizeStage(makeStageInput());

      expect(executor.calls[0].model).toBe('sonnet');
    });

    it('caches result in summaryRepo', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeStage(makeStageInput());

      const cached = summaryRepo.findByItem('STAGE-001-001-001', 'stage', repoId);
      expect(cached).not.toBeNull();
      expect(cached!.content_hash).toBe(computeHash(makeStageInput().file_content));
      expect(cached!.model).toBe('haiku');
    });

    it('returns cached summary on same content hash (cache hit)', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      // First call - generates
      const first = engine.summarizeStage(makeStageInput());
      expect(first.cached).toBe(false);
      expect(executor.calls).toHaveLength(1);

      // Second call - same content, should be cached
      const second = engine.summarizeStage(makeStageInput());
      expect(second.cached).toBe(true);
      expect(second.summary).toBe(first.summary);
      expect(executor.calls).toHaveLength(1); // no additional call
    });

    it('re-summarizes when content hash differs', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeStage(makeStageInput());
      expect(executor.calls).toHaveLength(1);

      // Modified content
      engine.summarizeStage(makeStageInput({ file_content: 'different content' }));
      expect(executor.calls).toHaveLength(2);
    });

    it('re-summarizes when --model specified and differs from cached model', () => {
      const executor = createMockExecutor();

      // First: cache with haiku
      const engine1 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });
      engine1.summarizeStage(makeStageInput());
      expect(executor.calls).toHaveLength(1);

      // Second: request sonnet explicitly
      const engine2 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        model: 'sonnet',
      });
      const result = engine2.summarizeStage(makeStageInput());
      expect(result.cached).toBe(false);
      expect(executor.calls).toHaveLength(2);
      expect(executor.calls[1].model).toBe('sonnet');
    });

    it('uses cached when --model NOT specified regardless of cached model', () => {
      const executor = createMockExecutor();

      // Cache with sonnet
      const engine1 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        model: 'sonnet',
      });
      engine1.summarizeStage(makeStageInput());

      // No model specified - should use cached even though model differs from default
      const engine2 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });
      const result = engine2.summarizeStage(makeStageInput());
      expect(result.cached).toBe(true);
      expect(executor.calls).toHaveLength(1); // no additional call
    });

    it('bypasses cache with --no-cache', () => {
      const executor = createMockExecutor();

      // First: cache normally
      const engine1 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });
      engine1.summarizeStage(makeStageInput());
      expect(executor.calls).toHaveLength(1);

      // Second: --no-cache should re-summarize
      const engine2 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        noCache: true,
      });
      const result = engine2.summarizeStage(makeStageInput());
      expect(result.cached).toBe(false);
      expect(executor.calls).toHaveLength(2);
    });

    it('handles executor failure gracefully', () => {
      const executor: ClaudeExecutor = {
        execute(): string {
          throw new Error('network timeout');
        },
      };
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const result = engine.summarizeStage(makeStageInput());
      expect(result.summary).toContain('[Error summarizing stage: network timeout]');
      expect(result.cached).toBe(false);
    });
  });

  // ─── Ticket summarization ──────────────────────────────────

  describe('summarizeTicket', () => {
    it('summarizes stages first, then ticket', () => {
      const executor = createMockExecutor(new Map([
        ['STAGE-001-001-001', 'Stage 1 summary'],
        ['STAGE-001-001-002', 'Stage 2 summary'],
        ['Ticket:', 'Ticket summary from stages'],
      ]));
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const { ticketResult, stageResults } = engine.summarizeTicket(makeTicketInput());

      expect(stageResults).toHaveLength(2);
      expect(stageResults[0].type).toBe('stage');
      expect(stageResults[1].type).toBe('stage');
      expect(ticketResult.type).toBe('ticket');
      expect(ticketResult.id).toBe('TICKET-001-001');
      expect(ticketResult.summary).toContain('Ticket summary');
      // 2 stage calls + 1 ticket call
      expect(executor.calls).toHaveLength(3);
    });

    it('caches ticket summary based on sorted stage summaries hash', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeTicket(makeTicketInput());

      const cached = summaryRepo.findByItem('TICKET-001-001', 'ticket', repoId);
      expect(cached).not.toBeNull();
      expect(cached!.item_type).toBe('ticket');
    });

    it('returns cached ticket on second call with same content', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeTicket(makeTicketInput());
      const callsAfterFirst = executor.calls.length;

      const { ticketResult } = engine.summarizeTicket(makeTicketInput());
      expect(ticketResult.cached).toBe(true);
      // Only stage lookups again (which are cached), no new ticket call
      expect(executor.calls.length).toBe(callsAfterFirst);
    });

    it('handles ticket with no stages', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const { ticketResult, stageResults } = engine.summarizeTicket(
        makeTicketInput({ stages: [] })
      );

      expect(stageResults).toHaveLength(0);
      expect(ticketResult.type).toBe('ticket');
      // 1 call for ticket (no stage calls)
      expect(executor.calls).toHaveLength(1);
    });
  });

  // ─── Epic summarization ────────────────────────────────────

  describe('summarizeEpic', () => {
    it('summarizes stages, tickets, then epic hierarchically', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const { epicResult, ticketResults, stageResults } = engine.summarizeEpic(makeEpicInput());

      expect(stageResults).toHaveLength(2);
      expect(ticketResults).toHaveLength(1);
      expect(epicResult.type).toBe('epic');
      expect(epicResult.id).toBe('EPIC-001');
      // 2 stage calls + 1 ticket call + 1 epic call
      expect(executor.calls).toHaveLength(4);
    });

    it('caches epic summary', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeEpic(makeEpicInput());

      const cached = summaryRepo.findByItem('EPIC-001', 'epic', repoId);
      expect(cached).not.toBeNull();
    });

    it('returns cached epic on second call with same content', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      engine.summarizeEpic(makeEpicInput());
      const callsAfterFirst = executor.calls.length;

      const { epicResult } = engine.summarizeEpic(makeEpicInput());
      expect(epicResult.cached).toBe(true);
      expect(executor.calls.length).toBe(callsAfterFirst); // all cached
    });

    it('handles epic with multiple tickets', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const epicInput = makeEpicInput({
        tickets: [
          makeTicketInput({ id: 'TICKET-001-001', title: 'Login Flow' }),
          makeTicketInput({
            id: 'TICKET-001-002',
            title: 'Registration Flow',
            stages: [makeStageInput({ id: 'STAGE-001-002-001', title: 'Signup Form' })],
          }),
        ],
      });

      const { epicResult, ticketResults, stageResults } = engine.summarizeEpic(epicInput);

      expect(stageResults).toHaveLength(3); // 2 from first ticket + 1 from second
      expect(ticketResults).toHaveLength(2);
      expect(epicResult.type).toBe('epic');
    });

    it('handles epic with no tickets', () => {
      const executor = createMockExecutor();
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const { epicResult, ticketResults, stageResults } = engine.summarizeEpic(
        makeEpicInput({ tickets: [] })
      );

      expect(stageResults).toHaveLength(0);
      expect(ticketResults).toHaveLength(0);
      expect(epicResult.type).toBe('epic');
      // 1 call for epic only
      expect(executor.calls).toHaveLength(1);
    });

    it('handles executor failure at stage level gracefully', () => {
      let callCount = 0;
      const executor: ClaudeExecutor = {
        execute(_prompt: string, model: string): string {
          callCount++;
          if (callCount === 1) throw new Error('stage error');
          return `Summary ${callCount}`;
        },
      };
      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
      });

      const { epicResult, stageResults } = engine.summarizeEpic(
        makeEpicInput({
          tickets: [makeTicketInput({ stages: [makeStageInput()] })],
        })
      );

      // Stage failed but ticket and epic should still work
      expect(stageResults[0].summary).toContain('[Error summarizing stage');
      expect(epicResult.type).toBe('epic');
    });
  });

  // ─── Model flag interactions ───────────────────────────────

  describe('model flag interactions', () => {
    it('--model with same model as cached uses cache', () => {
      const executor = createMockExecutor();

      const engine1 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        model: 'haiku',
      });
      engine1.summarizeStage(makeStageInput());

      const engine2 = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        model: 'haiku',
      });
      const result = engine2.summarizeStage(makeStageInput());
      expect(result.cached).toBe(true);
      expect(executor.calls).toHaveLength(1);
    });

    it('--no-cache still updates the cache after re-summarizing', () => {
      const executor = createMockExecutor();

      const engine = new SummaryEngine({
        executor,
        summaryRepo,
        repoId,
        noCache: true,
      });
      engine.summarizeStage(makeStageInput());

      // Verify it was cached (for future non-noCache calls)
      const cached = summaryRepo.findByItem('STAGE-001-001-001', 'stage', repoId);
      expect(cached).not.toBeNull();
    });
  });
});
