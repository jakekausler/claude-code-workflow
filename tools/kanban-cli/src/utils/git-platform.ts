import { execFileSync } from 'node:child_process';

/**
 * Supported git hosting platforms.
 */
export type GitPlatform = 'github' | 'gitlab' | 'unknown';

/**
 * Options for detecting the git platform.
 */
export interface DetectPlatformOptions {
  /** Override: explicit platform value (from env var or config). */
  configValue?: 'github' | 'gitlab' | 'auto';
  /** Override: env var value for WORKFLOW_GIT_PLATFORM. */
  envValue?: string;
  /** Function to read the git remote URL. Defaults to running `git remote get-url origin`. */
  getRemoteUrl?: () => string | null;
}

/**
 * Read the git remote URL for "origin" by shelling out to git.
 * Returns null if the command fails (no git repo, no remote, etc.).
 */
export function getGitRemoteUrl(): string | null {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Parse a git remote URL to determine the hosting platform.
 *
 * Recognizes:
 * - github.com anywhere in the URL -> 'github'
 * - gitlab. anywhere in the URL -> 'gitlab' (covers gitlab.com, self-hosted gitlab.company.com)
 * - Otherwise -> 'unknown'
 */
export function parsePlatformFromUrl(url: string): GitPlatform {
  const lower = url.toLowerCase();
  if (lower.includes('github.com')) {
    return 'github';
  }
  if (lower.includes('gitlab.')) {
    return 'gitlab';
  }
  return 'unknown';
}

/**
 * Detect the git hosting platform.
 *
 * Resolution order:
 * 1. If envValue is set to 'github' or 'gitlab', use that directly.
 * 2. If configValue is set to 'github' or 'gitlab', use that directly.
 * 3. Auto-detect from git remote URL.
 *
 * Both envValue and configValue of 'auto' (or undefined) trigger auto-detection.
 */
export function detectGitPlatform(options: DetectPlatformOptions = {}): GitPlatform {
  const { configValue, envValue, getRemoteUrl = getGitRemoteUrl } = options;

  // 1. Env var takes highest priority (explicit override)
  if (envValue === 'github' || envValue === 'gitlab') {
    return envValue;
  }

  // 2. Config value (from pipeline defaults)
  if (configValue === 'github' || configValue === 'gitlab') {
    return configValue;
  }

  // 3. Auto-detect from git remote URL
  const remoteUrl = getRemoteUrl();
  if (remoteUrl) {
    return parsePlatformFromUrl(remoteUrl);
  }

  return 'unknown';
}
