import type { PipelineConfig } from '../types/pipeline.js';
import { isSkillState } from '../types/pipeline.js';
import type { ValidationResult } from './config-validator.js';

/**
 * Function that reads a skill file's content by skill name.
 * Returns the file content as a string, or null if not found.
 */
export type SkillFileReader = (skillName: string) => Promise<string | null>;

/**
 * Function that validates skill content against expected transitions.
 * Returns true if the skill content appears to reference the expected transitions.
 *
 * Default implementation does a simple string search. LLM-powered implementation
 * can be injected for deeper semantic analysis.
 */
export type SkillContentAnalyzer = (
  skillContent: string,
  expectedTransitions: string[],
  stateName: string
) => Promise<{ valid: boolean; issues: string[] }>;

export interface SkillValidatorOptions {
  skillFileReader?: SkillFileReader;
  skillContentAnalyzer?: SkillContentAnalyzer;
}

/**
 * Default analyzer: checks if skill content mentions the expected transition targets.
 * This is a basic string-matching heuristic. For production use, inject an LLM-powered
 * analyzer that understands natural language instructions.
 */
const defaultAnalyzer: SkillContentAnalyzer = async (
  content,
  expectedTransitions,
  stateName
) => {
  const issues: string[] = [];
  for (const target of expectedTransitions) {
    if (!content.includes(target)) {
      issues.push(
        `Skill for "${stateName}" does not appear to reference transition target "${target}"`
      );
    }
  }
  return { valid: issues.length === 0, issues };
};

/**
 * Layer 3: Skill Content Validation.
 *
 * For each skill state, reads the skill file and checks that the content
 * references the expected transition targets. Skips resolver states.
 *
 * If no skillFileReader is provided, skips validation with a warning.
 */
export async function validateSkillContent(
  config: PipelineConfig,
  options: SkillValidatorOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { skillFileReader, skillContentAnalyzer } = options;

  if (!skillFileReader) {
    warnings.push('Layer 3 (skill content validation) skipped: no skill file reader provided');
    return { errors, warnings };
  }

  const analyzer = skillContentAnalyzer ?? defaultAnalyzer;

  for (const phase of config.workflow.phases) {
    if (!isSkillState(phase)) continue;

    const content = await skillFileReader(phase.skill);
    if (content === null) {
      warnings.push(`Skill file for "${phase.skill}" (state "${phase.name}") not found`);
      continue;
    }

    const result = await analyzer(content, phase.transitions_to, phase.name);
    if (!result.valid) {
      for (const issue of result.issues) {
        warnings.push(issue);
      }
    }
  }

  return { errors, warnings };
}
