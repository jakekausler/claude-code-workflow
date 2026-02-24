import type { ResolverRegistry } from '../registry.js';
import { prStatusResolver } from './pr-status.js';
import { testingRouterResolver } from './testing-router.js';

/**
 * Register all built-in resolvers with the given registry.
 */
export function registerBuiltinResolvers(registry: ResolverRegistry): void {
  registry.register('pr-status', prStatusResolver);
  registry.register('testing-router', testingRouterResolver);
}
