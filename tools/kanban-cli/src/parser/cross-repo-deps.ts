/**
 * Result of parsing a dependency reference.
 * - `local`: A dependency within the same repo (no slash in the ref).
 * - `cross-repo`: A dependency in another repo, formatted as `repoName/itemId`.
 */
export type DependencyRef =
  | { type: 'local'; itemId: string }
  | { type: 'cross-repo'; repoName: string; itemId: string };

/**
 * Parse a dependency reference string.
 *
 * If the ref contains a `/`, it is treated as a cross-repo dependency
 * where the part before the first `/` is the repo name and the rest
 * is the item ID.
 *
 * @param ref - Raw dependency string, e.g. `"STAGE-001-001-001"` or `"backend/STAGE-002-001-001"`
 */
export function parseDependencyRef(ref: string): DependencyRef {
  const slashIndex = ref.indexOf('/');
  if (slashIndex === -1) {
    return { type: 'local', itemId: ref };
  }
  return {
    type: 'cross-repo',
    repoName: ref.slice(0, slashIndex),
    itemId: ref.slice(slashIndex + 1),
  };
}

/**
 * Check whether a dependency reference string is a cross-repo dependency.
 */
export function isCrossRepoDep(ref: string): boolean {
  return ref.includes('/');
}

/**
 * Format a cross-repo dependency reference from its parts.
 */
export function formatCrossRepoDep(repoName: string, itemId: string): string {
  return `${repoName}/${itemId}`;
}
