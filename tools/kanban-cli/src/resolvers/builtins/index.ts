import type { ResolverRegistry } from '../registry.js';
import { prStatusResolver } from './pr-status.js';
import { stageRouterResolver } from './stage-router.js';

/**
 * Register all built-in resolvers with the given registry.
 */
export function registerBuiltinResolvers(registry: ResolverRegistry): void {
  registry.register('pr-status', prStatusResolver);
  registry.register('stage-router', stageRouterResolver);
}
