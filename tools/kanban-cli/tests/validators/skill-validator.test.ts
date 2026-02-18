import { describe, it, expect } from 'vitest';
import { validateSkillContent, type SkillFileReader } from '../../src/validators/skill-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateSkillContent (Layer 3)', () => {
  const config: PipelineConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
        { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
        { name: 'Check', resolver: 'pr-status', status: 'Check', transitions_to: ['Done'] },
      ],
    },
  };

  it('returns no errors when skill reader is not provided (skip mode)', async () => {
    const result = await validateSkillContent(config);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });

  it('returns no errors when skill files are found and valid', async () => {
    const reader: SkillFileReader = async (skillName: string) => {
      if (skillName === 'phase-design') return 'Set status to Build when design is complete.';
      if (skillName === 'phase-build') return 'Set status to Done when build is complete.';
      return null;
    };
    const result = await validateSkillContent(config, { skillFileReader: reader });
    expect(result.errors).toHaveLength(0);
  });

  it('warns when a skill file is not found', async () => {
    const reader: SkillFileReader = async () => null;
    const result = await validateSkillContent(config, { skillFileReader: reader });
    expect(result.warnings.some((w) => w.includes('not found'))).toBe(true);
  });

  it('skips resolver states (only validates skill states)', async () => {
    const reader: SkillFileReader = async (skillName: string) => {
      if (skillName === 'phase-design') return 'Set status to Build.';
      if (skillName === 'phase-build') return 'Set status to Done.';
      return null;
    };
    const result = await validateSkillContent(config, { skillFileReader: reader });
    // Should not warn about 'pr-status' since it's a resolver, not a skill
    expect(result.warnings.every((w) => !w.includes('pr-status'))).toBe(true);
  });
});
