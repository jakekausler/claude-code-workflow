import type { ResolverFn, ResolverStageInput, ResolverContext } from './types.js';

export class ResolverRegistry {
  private resolvers: Map<string, ResolverFn> = new Map();

  /**
   * Register a resolver function by name.
   * @throws If a resolver with this name is already registered.
   */
  register(name: string, fn: ResolverFn): void {
    if (this.resolvers.has(name)) {
      throw new Error(`Resolver "${name}" is already registered`);
    }
    this.resolvers.set(name, fn);
  }

  /** Get a resolver function by name, or null if not registered. */
  get(name: string): ResolverFn | null {
    return this.resolvers.get(name) ?? null;
  }

  /** Check if a resolver is registered. */
  has(name: string): boolean {
    return this.resolvers.has(name);
  }

  /** List all registered resolver names. */
  listNames(): string[] {
    return Array.from(this.resolvers.keys());
  }

  /**
   * Execute a resolver by name.
   * @returns The resolver's return value, or null if the resolver is not registered.
   */
  async execute(
    name: string,
    stage: ResolverStageInput,
    context: ResolverContext
  ): Promise<string | null> {
    const fn = this.resolvers.get(name);
    if (!fn) return null;
    return fn(stage, context);
  }
}
