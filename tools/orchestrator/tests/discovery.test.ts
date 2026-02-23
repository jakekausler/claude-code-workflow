import { describe, it, expect, vi } from 'vitest';
import { createDiscovery, type ExecFn } from '../src/discovery.js';

/** Sample kanban-cli next output with snake_case fields. */
function makeRawOutput(overrides?: {
  ready_stages?: Array<Record<string, unknown>>;
  blocked_count?: number;
  in_progress_count?: number;
  to_convert_count?: number;
}): string {
  return JSON.stringify({
    ready_stages: overrides?.ready_stages ?? [
      {
        id: 'STAGE-001-001-001',
        ticket: 'TICKET-001-001',
        epic: 'EPIC-001',
        title: 'Implement login API',
        worktree_branch: 'epic-001/ticket-001/stage-001-001-001',
        refinement_type: ['backend'],
        priority_score: 700,
        priority_reason: 'review_comments_pending',
        needs_human: false,
      },
      {
        id: 'STAGE-002-001-001',
        ticket: 'TICKET-002-001',
        epic: 'EPIC-002',
        title: 'Design database schema',
        worktree_branch: 'epic-002/ticket-001/stage-002-001-001',
        refinement_type: ['design'],
        priority_score: 500,
        priority_reason: 'normal_priority',
        needs_human: false,
      },
    ],
    blocked_count: overrides?.blocked_count ?? 5,
    in_progress_count: overrides?.in_progress_count ?? 2,
    to_convert_count: overrides?.to_convert_count ?? 1,
  });
}

describe('createDiscovery', () => {
  describe('parsing valid output', () => {
    it('parses valid kanban-cli next output', async () => {
      const execFn: ExecFn = vi.fn(async () => makeRawOutput());
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);

      expect(result.readyStages).toHaveLength(2);
      expect(result.blockedCount).toBe(5);
      expect(result.inProgressCount).toBe(2);
      expect(result.toConvertCount).toBe(1);
    });

    it('maps snake_case JSON fields to camelCase DiscoveryResult', async () => {
      const execFn: ExecFn = vi.fn(async () => makeRawOutput());
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);
      const stage = result.readyStages[0];

      expect(stage.id).toBe('STAGE-001-001-001');
      expect(stage.ticket).toBe('TICKET-001-001');
      expect(stage.epic).toBe('EPIC-001');
      expect(stage.title).toBe('Implement login API');
      expect(stage.worktreeBranch).toBe('epic-001/ticket-001/stage-001-001-001');
      expect(stage.priorityScore).toBe(700);
      expect(stage.priorityReason).toBe('review_comments_pending');
      expect(stage.needsHuman).toBe(false);
    });
  });

  describe('filtering needs_human stages', () => {
    it('filters out stages where needsHuman is true', async () => {
      const rawOutput = makeRawOutput({
        ready_stages: [
          {
            id: 'STAGE-001',
            ticket: 'TICKET-001',
            epic: 'EPIC-001',
            title: 'Automatable stage',
            worktree_branch: 'epic-001/stage-001',
            refinement_type: ['backend'],
            priority_score: 700,
            priority_reason: 'high_priority',
            needs_human: false,
          },
          {
            id: 'STAGE-002',
            ticket: 'TICKET-002',
            epic: 'EPIC-001',
            title: 'Human-only stage',
            worktree_branch: 'epic-001/stage-002',
            refinement_type: ['design'],
            priority_score: 900,
            priority_reason: 'requires_review',
            needs_human: true,
          },
          {
            id: 'STAGE-003',
            ticket: 'TICKET-003',
            epic: 'EPIC-002',
            title: 'Another automatable stage',
            worktree_branch: 'epic-002/stage-003',
            refinement_type: ['backend'],
            priority_score: 500,
            priority_reason: 'normal_priority',
            needs_human: false,
          },
        ],
      });

      const execFn: ExecFn = vi.fn(async () => rawOutput);
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 10);

      expect(result.readyStages).toHaveLength(2);
      expect(result.readyStages.map((s) => s.id)).toEqual(['STAGE-001', 'STAGE-003']);
    });

    it('returns empty readyStages when all stages need human', async () => {
      const rawOutput = makeRawOutput({
        ready_stages: [
          {
            id: 'STAGE-001',
            ticket: 'TICKET-001',
            epic: 'EPIC-001',
            title: 'Human stage',
            worktree_branch: 'epic-001/stage-001',
            refinement_type: ['design'],
            priority_score: 900,
            priority_reason: 'requires_review',
            needs_human: true,
          },
        ],
      });

      const execFn: ExecFn = vi.fn(async () => rawOutput);
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);

      expect(result.readyStages).toHaveLength(0);
    });
  });

  describe('empty ready_stages', () => {
    it('handles empty ready_stages (no work available)', async () => {
      const rawOutput = makeRawOutput({
        ready_stages: [],
        blocked_count: 10,
        in_progress_count: 3,
        to_convert_count: 0,
      });

      const execFn: ExecFn = vi.fn(async () => rawOutput);
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);

      expect(result.readyStages).toHaveLength(0);
      expect(result.blockedCount).toBe(10);
      expect(result.inProgressCount).toBe(3);
      expect(result.toConvertCount).toBe(0);
    });
  });

  describe('error handling', () => {
    it('rejects when exec fails (non-zero exit code)', async () => {
      const execFn: ExecFn = vi.fn(async () => {
        throw new Error('Command failed with exit code 1');
      });
      const discovery = createDiscovery({ execFn });

      await expect(discovery.discover('/tmp/test-repo', 5)).rejects.toThrow(
        'Command failed with exit code 1',
      );
    });

    it('rejects when exec returns invalid JSON', async () => {
      const execFn: ExecFn = vi.fn(async () => 'not valid json');
      const discovery = createDiscovery({ execFn });

      await expect(discovery.discover('/tmp/test-repo', 5)).rejects.toThrow();
    });
  });

  describe('command arguments', () => {
    it('passes correct --max and --repo arguments to the command', async () => {
      const execFn: ExecFn = vi.fn(async () => makeRawOutput());
      const discovery = createDiscovery({ execFn });

      await discovery.discover('/my/repo/path', 42);

      expect(execFn).toHaveBeenCalledTimes(1);
      const [command, args] = (execFn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(command).toBe('npx');
      expect(args).toContain('tsx');
      expect(args).toContain('next');
      expect(args).toContain('--repo');
      expect(args).toContain('/my/repo/path');
      expect(args).toContain('--max');
      expect(args).toContain('42');
    });

    it('includes both --repo and --max flags with correct values', async () => {
      const execFn: ExecFn = vi.fn(async () => makeRawOutput());
      const discovery = createDiscovery({ execFn });

      await discovery.discover('/tmp/repo', 10);

      const [, args] = (execFn as ReturnType<typeof vi.fn>).mock.calls[0];
      const repoIdx = args.indexOf('--repo');
      const maxIdx = args.indexOf('--max');
      expect(repoIdx).toBeGreaterThan(-1);
      expect(maxIdx).toBeGreaterThan(-1);
      // --repo value follows --repo flag
      expect(args[repoIdx + 1]).toBe('/tmp/repo');
      // --max value follows --max flag
      expect(args[maxIdx + 1]).toBe('10');
    });

    it('converts max number to string argument', async () => {
      const execFn: ExecFn = vi.fn(async () => makeRawOutput());
      const discovery = createDiscovery({ execFn });

      await discovery.discover('/tmp/repo', 7);

      const [, args] = (execFn as ReturnType<typeof vi.fn>).mock.calls[0];
      const maxIdx = args.indexOf('--max');
      expect(args[maxIdx + 1]).toBe('7');
      expect(typeof args[maxIdx + 1]).toBe('string');
    });
  });

  describe('counts', () => {
    it('returns correct blockedCount, inProgressCount, toConvertCount', async () => {
      const rawOutput = makeRawOutput({
        ready_stages: [],
        blocked_count: 15,
        in_progress_count: 7,
        to_convert_count: 3,
      });

      const execFn: ExecFn = vi.fn(async () => rawOutput);
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);

      expect(result.blockedCount).toBe(15);
      expect(result.inProgressCount).toBe(7);
      expect(result.toConvertCount).toBe(3);
    });

    it('returns zero counts when all are zero', async () => {
      const rawOutput = makeRawOutput({
        ready_stages: [],
        blocked_count: 0,
        in_progress_count: 0,
        to_convert_count: 0,
      });

      const execFn: ExecFn = vi.fn(async () => rawOutput);
      const discovery = createDiscovery({ execFn });

      const result = await discovery.discover('/tmp/test-repo', 5);

      expect(result.blockedCount).toBe(0);
      expect(result.inProgressCount).toBe(0);
      expect(result.toConvertCount).toBe(0);
    });
  });
});
