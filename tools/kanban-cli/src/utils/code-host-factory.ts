import type { CodeHostAdapter } from '../resolvers/types.js';
import type { GitPlatform } from './git-platform.js';
import { createGitHubAdapter } from './code-host-github.js';
import { createGitLabAdapter } from './code-host-gitlab.js';

/**
 * Create a CodeHostAdapter for the detected platform.
 * Returns null if the platform is 'unknown' (no adapter available).
 */
export function createCodeHostAdapter(platform: GitPlatform): CodeHostAdapter | null {
  switch (platform) {
    case 'github':
      return createGitHubAdapter();
    case 'gitlab':
      return createGitLabAdapter();
    case 'unknown':
      return null;
  }
}
