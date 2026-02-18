import type { PipelineConfig } from '../types/pipeline.js';
import { isResolverState } from '../types/pipeline.js';
import type { ResolverRegistry } from '../resolvers/registry.js';
import type { ValidationResult } from './config-validator.js';

export interface ResolverValidatorOptions {
  /** If true, execute each resolver with mock data to check for errors. */
  dryRun?: boolean;
}

/**
 * Layer 4: Resolver Validation.
 *
 * Checks:
 * - All resolver states reference a registered resolver function
 * - (dry-run) Resolver executes without throwing
 * - (dry-run) Resolver return value is in transitions_to or null
 */
export async function validateResolvers(
  config: PipelineConfig,
  registry: ResolverRegistry,
  options: ResolverValidatorOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const phase of config.workflow.phases) {
    if (!isResolverState(phase)) continue;

    // Check resolver is registered
    if (!registry.has(phase.resolver)) {
      errors.push(
        `State "${phase.name}": resolver "${phase.resolver}" is not registered`
      );
      continue;
    }

    // Dry-run if requested
    if (options.dryRun) {
      const mockStage = { id: 'MOCK-STAGE', status: phase.status };
      const mockContext = { env: {} };

      try {
        const result = await registry.execute(phase.resolver, mockStage, mockContext);
        if (result !== null) {
          // Check that the result is a valid transition target
          if (!phase.transitions_to.includes(result)) {
            warnings.push(
              `State "${phase.name}": resolver "${phase.resolver}" returned "${result}" which is not in transitions_to [${phase.transitions_to.join(', ')}]`
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          `State "${phase.name}": resolver "${phase.resolver}" threw during dry-run: ${message}`
        );
      }
    }
  }

  return { errors, warnings };
}
