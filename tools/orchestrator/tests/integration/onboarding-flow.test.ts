import { describe, it, expect } from 'vitest';
import type { PipelineConfig, PipelineState } from 'kanban-cli';
import { makeFrontmatterStore, makeLogger } from './helpers.js';

/**
 * Integration tests for the "Not Started" onboarding flow.
 *
 * The orchestrator loop onboards stages with status "Not Started" by
 * reading their frontmatter, updating the status to the pipeline's entry
 * phase, and writing it back. These tests verify that the frontmatter
 * read/write path works correctly with the expected data shapes.
 *
 * The actual onboarding logic lives in the orchestrator loop (loop.ts).
 * Here we simulate the same sequence against the mock frontmatter store
 * to verify the data flow end-to-end without needing the full orchestrator.
 */

const REPO_PATH = '/repo';

/** Pipeline config with Design as entry phase. */
function makePipelineConfig(): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'Design', skill: 'design', transitions_to: ['Build'] },
        { name: 'Build', status: 'Build', skill: 'implement', transitions_to: ['Complete'] },
      ],
    },
  };
}

/**
 * Simulate the onboarding logic from loop.ts.
 *
 * This mirrors the code in createOrchestrator's start() method:
 *   1. Read frontmatter from the stage file
 *   2. Check if status is "Not Started"
 *   3. Find the entry phase from pipeline config
 *   4. Update frontmatter status to entry phase status
 *   5. Write frontmatter back
 */
async function simulateOnboarding(
  stageFilePath: string,
  pipelineConfig: PipelineConfig,
  readFrontmatter: (filePath: string) => Promise<{ data: Record<string, unknown>; content: string }>,
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>,
  logger: { info: (...args: unknown[]) => void },
): Promise<{ onboarded: boolean; newStatus: string | null }> {
  const { data, content } = await readFrontmatter(stageFilePath);
  const statusBefore = data.status as string;

  if (statusBefore !== 'Not Started') {
    return { onboarded: false, newStatus: null };
  }

  const entryPhase = pipelineConfig.workflow.entry_phase;
  const entryState = pipelineConfig.workflow.phases.find(
    (p: PipelineState) => p.name === entryPhase,
  );

  if (!entryState) {
    return { onboarded: false, newStatus: null };
  }

  data.status = entryState.status;
  await writeFrontmatter(stageFilePath, data, content);
  logger.info('Onboarded stage to entry phase', { status: entryState.status });

  return { onboarded: true, newStatus: entryState.status };
}

describe('Onboarding Flow Integration', () => {
  describe('Stage with status "Not Started" transitions to entry phase', () => {
    it('updates frontmatter status from "Not Started" to "Design"', async () => {
      const stageFilePath = `${REPO_PATH}/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md`;

      const fm = makeFrontmatterStore({
        [stageFilePath]: {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Not Started',
            session_active: false,
          },
          content: '# Stage\n',
        },
      });

      const logger = makeLogger();
      const pipelineConfig = makePipelineConfig();

      const result = await simulateOnboarding(
        stageFilePath,
        pipelineConfig,
        fm.readFrontmatter,
        fm.writeFrontmatter,
        logger,
      );

      // Onboarding happened
      expect(result.onboarded).toBe(true);
      expect(result.newStatus).toBe('Design');

      // Store was updated
      const stageData = fm.store[stageFilePath].data;
      expect(stageData.status).toBe('Design');

      // Other fields preserved
      expect(stageData.id).toBe('STAGE-001-001-001');
      expect(stageData.ticket).toBe('TICKET-001-001');
      expect(stageData.epic).toBe('EPIC-001');
      expect(stageData.session_active).toBe(false);

      // Logger was called
      expect(logger.info).toHaveBeenCalledWith(
        'Onboarded stage to entry phase',
        { status: 'Design' },
      );

      // readFrontmatter and writeFrontmatter were each called once
      expect(fm.readFrontmatter).toHaveBeenCalledTimes(1);
      expect(fm.writeFrontmatter).toHaveBeenCalledTimes(1);
    });
  });

  describe('Stage already in progress is not onboarded', () => {
    it('skips stages that already have a non-"Not Started" status', async () => {
      const stageFilePath = `${REPO_PATH}/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md`;

      const fm = makeFrontmatterStore({
        [stageFilePath]: {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Build',
            session_active: false,
          },
          content: '# Stage\n',
        },
      });

      const logger = makeLogger();
      const pipelineConfig = makePipelineConfig();

      const result = await simulateOnboarding(
        stageFilePath,
        pipelineConfig,
        fm.readFrontmatter,
        fm.writeFrontmatter,
        logger,
      );

      // No onboarding
      expect(result.onboarded).toBe(false);
      expect(result.newStatus).toBeNull();

      // Store unchanged
      expect(fm.store[stageFilePath].data.status).toBe('Build');

      // No writes
      expect(fm.writeFrontmatter).not.toHaveBeenCalled();
    });
  });

  describe('Onboarding preserves markdown content', () => {
    it('writes back the original content body unchanged', async () => {
      const stageFilePath = `${REPO_PATH}/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md`;
      const originalContent = '# My Stage\n\nSome detailed description here.\n\n## Notes\n- Item 1\n- Item 2\n';

      const fm = makeFrontmatterStore({
        [stageFilePath]: {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Not Started',
          },
          content: originalContent,
        },
      });

      const logger = makeLogger();
      const pipelineConfig = makePipelineConfig();

      await simulateOnboarding(
        stageFilePath,
        pipelineConfig,
        fm.readFrontmatter,
        fm.writeFrontmatter,
        logger,
      );

      // Status updated
      expect(fm.store[stageFilePath].data.status).toBe('Design');

      // Content preserved exactly
      expect(fm.store[stageFilePath].content).toBe(originalContent);
    });
  });
});
