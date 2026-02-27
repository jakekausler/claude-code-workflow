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
  if (ref === '') {
    throw new Error('Dependency reference cannot be empty');
  }
  const slashIndex = ref.indexOf('/');
  if (slashIndex === -1) {
    return { type: 'local', itemId: ref };
  }
  const repoName = ref.slice(0, slashIndex);
  const itemId = ref.slice(slashIndex + 1);
  if (repoName === '') {
    throw new Error('Invalid cross-repo dependency: empty repo name');
  }
  if (itemId === '') {
    throw new Error('Invalid cross-repo dependency: empty item ID');
  }
  return { type: 'cross-repo', repoName, itemId };
}

/**
 * Check whether a dependency reference string is a cross-repo dependency.
 */
export function isCrossRepoDep(ref: string): boolean {
  const slashIndex = ref.indexOf('/');
  return slashIndex > 0 && slashIndex < ref.length - 1;
}

/**
 * Format a cross-repo dependency reference from its parts.
 */
export function formatCrossRepoDep(repoName: string, itemId: string): string {
  return `${repoName}/${itemId}`;
}
