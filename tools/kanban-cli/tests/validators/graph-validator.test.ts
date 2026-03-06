import { describe, it, expect } from 'vitest';
import { validateGraph } from '../../src/validators/graph-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateGraph (Layer 2)', () => {
  it('accepts a simple linear pipeline', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when a state cannot reach Done', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['A'] }, // cycle, no Done
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors.some((e) => e.includes('cannot reach Done'))).toBe(true);
  });

  it('accepts a cycle that has an exit to Done', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['A', 'Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on unreachable state from entry', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['Done'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['Done'] }, // unreachable
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('accepts a branching/converging DAG', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Router',
        phases: [
          { name: 'Router', resolver: 'stage-router', status: 'Routing', transitions_to: ['A', 'B'] },
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['C'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['C'] },
          { name: 'C', skill: 's-c', status: 'C', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts the default pipeline', async () => {
    // Import and test against the actual default config
    const { defaultPipelineConfig } = await import('../../src/config/defaults.js');
    const result = validateGraph(defaultPipelineConfig);
    expect(result.errors).toHaveLength(0);
  });

  it('handles complex cycle with exit path', () => {
    // PR Created ↔ Addressing Comments, with PR Created → Done
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Finalize',
        phases: [
          { name: 'Finalize', skill: 's-f', status: 'Finalize', transitions_to: ['PR Created'] },
          { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
          { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });
});
