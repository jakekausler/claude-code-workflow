import type { PipelineConfig } from '../types/pipeline.js';
import type { ResolverRegistry } from '../resolvers/registry.js';
import { validateConfig, type ValidationResult } from './config-validator.js';
import { validateGraph } from './graph-validator.js';
import { validateSkillContent, type SkillValidatorOptions } from './skill-validator.js';
import { validateResolvers, type ResolverValidatorOptions } from './resolver-validator.js';

export interface PipelineValidationOptions {
  registry?: ResolverRegistry;
  skillOptions?: SkillValidatorOptions;
  resolverOptions?: ResolverValidatorOptions;
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  layers: {
    config: ValidationResult;
    graph: ValidationResult;
    skillContent: ValidationResult;
    resolver: ValidationResult;
  };
}

/**
 * Run all four validation layers on a pipeline config and aggregate results.
 */
export async function validatePipeline(
  config: PipelineConfig,
  options: PipelineValidationOptions = {}
): Promise<PipelineValidationResult> {
  // Layer 1: Config validation
  const configResult = validateConfig(config);

  // Layer 2: Graph validation (only if Layer 1 passed — graph needs valid structure)
  const graphResult =
    configResult.errors.length === 0
      ? validateGraph(config)
      : { errors: [], warnings: ['Layer 2 skipped due to Layer 1 errors'] };

  // Layer 3: Skill content validation
  const skillResult = await validateSkillContent(config, options.skillOptions);

  // Layer 4: Resolver validation
  const resolverResult = options.registry
    ? await validateResolvers(config, options.registry, options.resolverOptions)
    : { errors: [], warnings: ['Layer 4 skipped: no resolver registry provided'] };

  // Aggregate
  const allErrors = [
    ...configResult.errors,
    ...graphResult.errors,
    ...skillResult.errors,
    ...resolverResult.errors,
  ];
  const allWarnings = [
    ...configResult.warnings,
    ...graphResult.warnings,
    ...skillResult.warnings,
    ...resolverResult.warnings,
  ];

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    layers: {
      config: configResult,
      graph: graphResult,
      skillContent: skillResult,
      resolver: resolverResult,
    },
  };
}
