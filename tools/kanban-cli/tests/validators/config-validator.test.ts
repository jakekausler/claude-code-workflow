import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/validators/config-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateConfig (Layer 1)', () => {
  const validConfig: PipelineConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
        { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
      ],
    },
  };

  it('accepts a valid config with no errors', () => {
    const result = validateConfig(validConfig);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when entry_phase references nonexistent state', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'NonExistent',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('entry_phase'))).toBe(true);
  });

  it('errors when transitions_to references nonexistent state (not Done)', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['NonExistent'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('NonExistent'))).toBe(true);
  });

  it('accepts Done as a valid transition target', () => {
    const result = validateConfig(validConfig);
    // Build → Done is valid
    expect(result.errors).toHaveLength(0);
  });

  it('errors on duplicate status values', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Active', transitions_to: ['Build'] },
          { name: 'Build', skill: 'phase-build', status: 'Active', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('duplicate') || e.includes('Duplicate'))).toBe(true);
  });

  it('errors on duplicate state names', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Design2'] },
          { name: 'Design', skill: 'phase-build', status: 'Design2', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('duplicate') || e.includes('Duplicate'))).toBe(true);
  });

  it('warns on phases not reachable via transitions (orphans caught here as warning)', () => {
    // Note: full reachability is Layer 2, but obvious disconnects can be warned here
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
          { name: 'Orphan', skill: 'orphan-skill', status: 'Orphan', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.warnings.some((w) => w.includes('Orphan'))).toBe(true);
  });
});
