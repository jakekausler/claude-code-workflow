# Stage 3A: Git Platform Detection & PR Status Resolver

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add git platform auto-detection utility and replace the pr-status resolver stub with production code that queries GitHub/GitLab CLIs for PR merge status and unresolved comments.

**Status:** Not Started

**Prerequisites:** Stage 1 complete (all 290 tests passing). The pr-status resolver stub already exists at `src/resolvers/builtins/pr-status.ts` and is registered in `src/resolvers/builtins/index.ts`. The `ResolverStageInput` type already has `pr_url?: string`. The `ResolverContext` type already has `codeHost?` and `env` fields. The `WorkflowDefaults` type already has `WORKFLOW_GIT_PLATFORM?: 'github' | 'gitlab' | 'auto'`. The default pipeline YAML already sets `WORKFLOW_GIT_PLATFORM: auto`.

**Architecture:** Two new modules:
1. `src/utils/git-platform.ts` -- Detects whether the project uses GitHub or GitLab by checking (in order): env var override, pipeline config defaults, then git remote URL parsing.
2. Updated `src/resolvers/builtins/pr-status.ts` -- Replaces the current `context.codeHost` stub approach with direct CLI invocation (`gh pr view` / `glab mr view`), using `child_process.execFileSync` for safety.

The existing `ResolverContext.codeHost` interface will be replaced by a new `CodeHostAdapter` interface that wraps CLI execution, making it testable via dependency injection.

**Tech Stack:** TypeScript, `node:child_process` (execFileSync), Vitest (with `vi.mock` for child_process mocking)

---

### Task 1: Define GitPlatform Type and CodeHostAdapter Interface

**Files:**
- Create: `tools/kanban-cli/src/utils/git-platform.ts` (types only, implementation in Task 2)
- Modify: `tools/kanban-cli/src/resolvers/types.ts` (update `ResolverContext.codeHost`)

**Step 1: Create the git-platform module with types and detection function signature**

Create `tools/kanban-cli/src/utils/git-platform.ts`:

```typescript
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
```

**Step 2: Update ResolverContext.codeHost in types.ts**

In `tools/kanban-cli/src/resolvers/types.ts`, replace the existing `codeHost` field with a more flexible interface that includes the platform:

```typescript
/**
 * Minimal stage data passed to resolvers.
 * Full stage type will be defined in Stage 1 when frontmatter parsing is built.
 */
export interface ResolverStageInput {
  id: string;
  status: string;
  ticket_id?: string;
  epic_id?: string;
  pr_url?: string;
  pr_number?: number;
  worktree_branch?: string;
  refinement_type?: string[];
  [key: string]: unknown;
}

/**
 * PR/MR status returned by the code host adapter.
 */
export interface PRStatus {
  /** Whether the PR/MR has been merged */
  merged: boolean;
  /** Whether there are unresolved review comments */
  hasUnresolvedComments: boolean;
  /** Raw state string from the platform (e.g., 'open', 'closed', 'merged') */
  state: string;
}

/**
 * Adapter for querying code host (GitHub/GitLab) PR/MR status.
 * Implementations can shell out to `gh`/`glab` CLI or call APIs directly.
 */
export interface CodeHostAdapter {
  getPRStatus(prUrl: string): PRStatus;
}

/**
 * Context provided to resolver functions by the orchestration loop.
 */
export interface ResolverContext {
  /** Access to code host API (GitHub/GitLab) -- injected by orchestration loop */
  codeHost?: CodeHostAdapter;
  /** Current environment variable values */
  env: Record<string, string | undefined>;
}

/**
 * A resolver function. Called by the orchestration loop on each tick
 * for stages in a resolver state.
 *
 * @returns A transition target name (from transitions_to), or null for no change.
 */
export type ResolverFn = (
  stage: ResolverStageInput,
  context: ResolverContext
) => string | null | Promise<string | null>;
```

**IMPORTANT:** The key change to `ResolverContext` is:
- `codeHost.getPRStatus` is now synchronous (returns `PRStatus` not `Promise<PRStatus>`), since `execFileSync` is synchronous.
- The return type name changed from inline `{ merged; hasNewUnresolvedComments; state }` to the named `PRStatus` interface.
- The field `hasNewUnresolvedComments` is renamed to `hasUnresolvedComments` (simpler name, same meaning).

**Step 3: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`

This will likely produce errors in the existing pr-status resolver and tests because the interface changed. That is expected -- they will be fixed in Tasks 4 and 5.

**Step 4: Commit (types only)**

```bash
git add tools/kanban-cli/src/utils/git-platform.ts tools/kanban-cli/src/resolvers/types.ts
git commit -m "feat(kanban-cli): add GitPlatform type, CodeHostAdapter interface, and platform detection utility"
```

---

### Task 2: Write Git Platform Detection Tests

**Files:**
- Create: `tools/kanban-cli/tests/utils/git-platform.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import {
  detectGitPlatform,
  parsePlatformFromUrl,
  getGitRemoteUrl,
} from '../../src/utils/git-platform.js';
import type { GitPlatform } from '../../src/utils/git-platform.js';

describe('parsePlatformFromUrl', () => {
  it('detects github.com HTTPS URL', () => {
    expect(parsePlatformFromUrl('https://github.com/org/repo.git')).toBe('github');
  });

  it('detects github.com SSH URL', () => {
    expect(parsePlatformFromUrl('git@github.com:org/repo.git')).toBe('github');
  });

  it('detects gitlab.com HTTPS URL', () => {
    expect(parsePlatformFromUrl('https://gitlab.com/org/repo.git')).toBe('gitlab');
  });

  it('detects gitlab.com SSH URL', () => {
    expect(parsePlatformFromUrl('git@gitlab.com:org/repo.git')).toBe('gitlab');
  });

  it('detects self-hosted GitLab (gitlab.company.com)', () => {
    expect(parsePlatformFromUrl('https://gitlab.mycompany.com/org/repo.git')).toBe('gitlab');
  });

  it('returns unknown for bitbucket', () => {
    expect(parsePlatformFromUrl('https://bitbucket.org/org/repo.git')).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    expect(parsePlatformFromUrl('')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(parsePlatformFromUrl('https://GITHUB.COM/org/repo.git')).toBe('github');
    expect(parsePlatformFromUrl('https://GITLAB.COM/org/repo.git')).toBe('gitlab');
  });
});

describe('detectGitPlatform', () => {
  const mockRemote = (url: string | null) => () => url;

  describe('env var override', () => {
    it('uses envValue=github directly', () => {
      const result = detectGitPlatform({
        envValue: 'github',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });

    it('uses envValue=gitlab directly', () => {
      const result = detectGitPlatform({
        envValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('gitlab');
    });

    it('envValue=auto triggers auto-detection', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('envValue takes priority over configValue', () => {
      const result = detectGitPlatform({
        envValue: 'github',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });
  });

  describe('config value override', () => {
    it('uses configValue=github when envValue is not set', () => {
      const result = detectGitPlatform({
        configValue: 'github',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });

    it('uses configValue=gitlab when envValue is not set', () => {
      const result = detectGitPlatform({
        configValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('gitlab');
    });

    it('configValue=auto triggers auto-detection', () => {
      const result = detectGitPlatform({
        configValue: 'auto',
        getRemoteUrl: mockRemote('https://gitlab.com/org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });
  });

  describe('auto-detection from remote URL', () => {
    it('detects github from remote URL', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('git@github.com:org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('detects gitlab from remote URL', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('git@gitlab.mycompany.com:org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });

    it('returns unknown when remote URL is null', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('unknown');
    });

    it('returns unknown when remote URL is unrecognized', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('https://bitbucket.org/org/repo.git'),
      });
      expect(result).toBe('unknown');
    });
  });

  describe('full resolution order', () => {
    it('env > config > remote', () => {
      // env says github, config says gitlab, remote says gitlab
      const result = detectGitPlatform({
        envValue: 'github',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote('https://gitlab.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('config > remote when env is auto', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });

    it('remote used when both env and config are auto', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        configValue: 'auto',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });
  });
});

describe('getGitRemoteUrl', () => {
  // This test exercises the real git command.
  // It will return a URL if we are in a git repo with an origin remote,
  // or null otherwise. We just verify it doesn't throw.
  it('returns a string or null without throwing', () => {
    const result = getGitRemoteUrl();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
```

**Step 2: Run the tests**

Run: `cd tools/kanban-cli && npx vitest run tests/utils/git-platform.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add tools/kanban-cli/tests/utils/git-platform.test.ts
git commit -m "test(kanban-cli): add git platform detection tests"
```

---

### Task 3: Create GitHub Code Host Adapter

**Files:**
- Create: `tools/kanban-cli/src/utils/code-host-github.ts`

This adapter shells out to the `gh` CLI to get PR status.

**Step 1: Write the GitHub adapter**

Create `tools/kanban-cli/src/utils/code-host-github.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import type { CodeHostAdapter, PRStatus } from '../resolvers/types.js';

/**
 * JSON shape returned by `gh pr view --json state,mergedAt,reviewDecision,reviews`.
 */
interface GhPrViewOutput {
  state: string;           // 'OPEN' | 'CLOSED' | 'MERGED'
  mergedAt: string | null; // ISO date or null
  reviewDecision: string;  // 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  reviews: Array<{
    state: string;         // 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
    author: { login: string };
  }>;
}

/**
 * Options for constructing the GitHub adapter.
 */
export interface GitHubAdapterOptions {
  /**
   * Function to execute the `gh` CLI. Defaults to execFileSync.
   * Injected for testing.
   */
  execFn?: (command: string, args: string[]) => string;
}

/**
 * Extract the owner/repo and PR number from a GitHub PR URL.
 *
 * Accepts formats:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files (trailing path segments)
 *
 * Returns null if the URL doesn't match.
 */
export function parseGitHubPrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

function defaultExec(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Code host adapter that uses the `gh` CLI to query GitHub PR status.
 */
export function createGitHubAdapter(options: GitHubAdapterOptions = {}): CodeHostAdapter {
  const exec = options.execFn ?? defaultExec;

  return {
    getPRStatus(prUrl: string): PRStatus {
      const parsed = parseGitHubPrUrl(prUrl);
      if (!parsed) {
        return { merged: false, hasUnresolvedComments: false, state: 'unknown' };
      }

      try {
        const json = exec('gh', [
          'pr', 'view',
          String(parsed.number),
          '--repo', `${parsed.owner}/${parsed.repo}`,
          '--json', 'state,mergedAt,reviewDecision,reviews',
        ]);

        const data: GhPrViewOutput = JSON.parse(json);

        const merged = data.state === 'MERGED' || data.mergedAt !== null;
        const hasUnresolvedComments = data.reviewDecision === 'CHANGES_REQUESTED';
        const state = data.state.toLowerCase();

        return { merged, hasUnresolvedComments, state };
      } catch {
        // gh CLI not installed, not authenticated, network error, etc.
        return { merged: false, hasUnresolvedComments: false, state: 'error' };
      }
    },
  };
}
```

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: May still have errors from the old pr-status resolver and tests referencing the old interface. Those are fixed in Tasks 4 and 5.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/utils/code-host-github.ts
git commit -m "feat(kanban-cli): add GitHub code host adapter using gh CLI"
```

---

### Task 4: Create GitLab Code Host Adapter

**Files:**
- Create: `tools/kanban-cli/src/utils/code-host-gitlab.ts`

This adapter shells out to the `glab` CLI to get MR status.

**Step 1: Write the GitLab adapter**

Create `tools/kanban-cli/src/utils/code-host-gitlab.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import type { CodeHostAdapter, PRStatus } from '../resolvers/types.js';

/**
 * JSON shape returned by `glab mr view --output json`.
 *
 * glab returns a flat JSON with these relevant fields (among others).
 */
interface GlabMrViewOutput {
  state: string;                // 'opened' | 'closed' | 'merged'
  merged_at: string | null;     // ISO date or null
  has_conflicts: boolean;
  blocking_discussions_resolved: boolean;
}

/**
 * Options for constructing the GitLab adapter.
 */
export interface GitLabAdapterOptions {
  /**
   * Function to execute the `glab` CLI. Defaults to execFileSync.
   * Injected for testing.
   */
  execFn?: (command: string, args: string[]) => string;
}

/**
 * Extract the project path and MR number from a GitLab MR URL.
 *
 * Accepts formats:
 * - https://gitlab.com/group/project/-/merge_requests/123
 * - https://gitlab.company.com/group/subgroup/project/-/merge_requests/123
 *
 * Returns null if the URL doesn't match.
 */
export function parseGitLabMrUrl(url: string): { project: string; number: number } | null {
  const match = url.match(/gitlab\.[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!match) return null;
  return { project: match[1], number: parseInt(match[2], 10) };
}

function defaultExec(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Code host adapter that uses the `glab` CLI to query GitLab MR status.
 */
export function createGitLabAdapter(options: GitLabAdapterOptions = {}): CodeHostAdapter {
  const exec = options.execFn ?? defaultExec;

  return {
    getPRStatus(prUrl: string): PRStatus {
      const parsed = parseGitLabMrUrl(prUrl);
      if (!parsed) {
        return { merged: false, hasUnresolvedComments: false, state: 'unknown' };
      }

      try {
        const json = exec('glab', [
          'mr', 'view',
          String(parsed.number),
          '--repo', parsed.project,
          '--output', 'json',
        ]);

        const data: GlabMrViewOutput = JSON.parse(json);

        const merged = data.state === 'merged' || data.merged_at !== null;
        const hasUnresolvedComments = !data.blocking_discussions_resolved;
        const state = data.state;

        return { merged, hasUnresolvedComments, state };
      } catch {
        // glab CLI not installed, not authenticated, network error, etc.
        return { merged: false, hasUnresolvedComments: false, state: 'error' };
      }
    },
  };
}
```

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/utils/code-host-gitlab.ts
git commit -m "feat(kanban-cli): add GitLab code host adapter using glab CLI"
```

---

### Task 5: Write Code Host Adapter Tests

**Files:**
- Create: `tools/kanban-cli/tests/utils/code-host-github.test.ts`
- Create: `tools/kanban-cli/tests/utils/code-host-gitlab.test.ts`

**Step 1: Write GitHub adapter tests**

Create `tools/kanban-cli/tests/utils/code-host-github.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createGitHubAdapter,
  parseGitHubPrUrl,
} from '../../src/utils/code-host-github.js';

describe('parseGitHubPrUrl', () => {
  it('parses standard GitHub PR URL', () => {
    const result = parseGitHubPrUrl('https://github.com/myorg/myrepo/pull/42');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 42 });
  });

  it('parses URL with trailing path segments', () => {
    const result = parseGitHubPrUrl('https://github.com/myorg/myrepo/pull/42/files');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 42 });
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubPrUrl('https://gitlab.com/org/repo/-/merge_requests/1')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseGitHubPrUrl('not-a-url')).toBeNull();
  });

  it('returns null for GitHub URL without PR number', () => {
    expect(parseGitHubPrUrl('https://github.com/org/repo')).toBeNull();
  });
});

describe('createGitHubAdapter', () => {
  const mergedResponse = JSON.stringify({
    state: 'MERGED',
    mergedAt: '2026-02-18T10:00:00Z',
    reviewDecision: 'APPROVED',
    reviews: [],
  });

  const openResponse = JSON.stringify({
    state: 'OPEN',
    mergedAt: null,
    reviewDecision: '',
    reviews: [],
  });

  const changesRequestedResponse = JSON.stringify({
    state: 'OPEN',
    mergedAt: null,
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [
      { state: 'CHANGES_REQUESTED', author: { login: 'reviewer1' } },
    ],
  });

  it('returns merged=true when PR is merged', () => {
    const adapter = createGitHubAdapter({
      execFn: () => mergedResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(true);
    expect(status.state).toBe('merged');
  });

  it('returns merged=false for open PR', () => {
    const adapter = createGitHubAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('open');
  });

  it('returns hasUnresolvedComments=true when changes requested', () => {
    const adapter = createGitHubAdapter({
      execFn: () => changesRequestedResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(true);
  });

  it('passes correct args to gh CLI', () => {
    let capturedArgs: string[] = [];
    const adapter = createGitHubAdapter({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return openResponse;
      },
    });
    adapter.getPRStatus('https://github.com/myorg/myrepo/pull/42');
    expect(capturedArgs).toEqual([
      'pr', 'view', '42',
      '--repo', 'myorg/myrepo',
      '--json', 'state,mergedAt,reviewDecision,reviews',
    ]);
  });

  it('returns error state when CLI throws', () => {
    const adapter = createGitHubAdapter({
      execFn: () => { throw new Error('gh not found'); },
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('error');
  });

  it('returns unknown state for unparseable URL', () => {
    const adapter = createGitHubAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://bitbucket.org/org/repo/pull/1');
    expect(status.state).toBe('unknown');
  });
});
```

**Step 2: Write GitLab adapter tests**

Create `tools/kanban-cli/tests/utils/code-host-gitlab.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createGitLabAdapter,
  parseGitLabMrUrl,
} from '../../src/utils/code-host-gitlab.js';

describe('parseGitLabMrUrl', () => {
  it('parses standard GitLab MR URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.com/mygroup/myproject/-/merge_requests/42');
    expect(result).toEqual({ project: 'mygroup/myproject', number: 42 });
  });

  it('parses self-hosted GitLab URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.mycompany.com/team/project/-/merge_requests/7');
    expect(result).toEqual({ project: 'team/project', number: 7 });
  });

  it('parses nested subgroup URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.com/group/subgroup/project/-/merge_requests/99');
    expect(result).toEqual({ project: 'group/subgroup/project', number: 99 });
  });

  it('returns null for non-GitLab URL', () => {
    expect(parseGitLabMrUrl('https://github.com/org/repo/pull/1')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseGitLabMrUrl('not-a-url')).toBeNull();
  });
});

describe('createGitLabAdapter', () => {
  const mergedResponse = JSON.stringify({
    state: 'merged',
    merged_at: '2026-02-18T10:00:00Z',
    has_conflicts: false,
    blocking_discussions_resolved: true,
  });

  const openResponse = JSON.stringify({
    state: 'opened',
    merged_at: null,
    has_conflicts: false,
    blocking_discussions_resolved: true,
  });

  const unresolvedResponse = JSON.stringify({
    state: 'opened',
    merged_at: null,
    has_conflicts: false,
    blocking_discussions_resolved: false,
  });

  it('returns merged=true when MR is merged', () => {
    const adapter = createGitLabAdapter({
      execFn: () => mergedResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(true);
    expect(status.state).toBe('merged');
  });

  it('returns merged=false for open MR', () => {
    const adapter = createGitLabAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
  });

  it('returns hasUnresolvedComments=true when discussions unresolved', () => {
    const adapter = createGitLabAdapter({
      execFn: () => unresolvedResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(true);
  });

  it('passes correct args to glab CLI', () => {
    let capturedArgs: string[] = [];
    const adapter = createGitLabAdapter({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return openResponse;
      },
    });
    adapter.getPRStatus('https://gitlab.com/mygroup/myproject/-/merge_requests/42');
    expect(capturedArgs).toEqual([
      'mr', 'view', '42',
      '--repo', 'mygroup/myproject',
      '--output', 'json',
    ]);
  });

  it('returns error state when CLI throws', () => {
    const adapter = createGitLabAdapter({
      execFn: () => { throw new Error('glab not found'); },
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('error');
  });

  it('returns unknown state for unparseable URL', () => {
    const adapter = createGitLabAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.state).toBe('unknown');
  });
});
```

**Step 3: Run the tests**

Run: `cd tools/kanban-cli && npx vitest run tests/utils/`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add tools/kanban-cli/tests/utils/code-host-github.test.ts tools/kanban-cli/tests/utils/code-host-gitlab.test.ts
git commit -m "test(kanban-cli): add code host adapter tests for GitHub and GitLab"
```

---

### Task 6: Update pr-status Resolver to Use CodeHostAdapter

**Files:**
- Modify: `tools/kanban-cli/src/resolvers/builtins/pr-status.ts`

**Step 1: Replace the existing stub**

Replace the entire contents of `tools/kanban-cli/src/resolvers/builtins/pr-status.ts` with:

```typescript
import type { ResolverFn } from '../types.js';

/**
 * Built-in resolver for the "PR Created" state.
 * Queries the code host CLI to check PR/MR status.
 *
 * Returns:
 * - "Done" if PR/MR is merged
 * - "Addressing Comments" if PR/MR has unresolved review comments
 * - null if no change (PR still open, no actionable comments)
 *
 * Requires `context.codeHost` to be injected by the orchestration loop.
 * If no code host adapter is available or the stage has no `pr_url`, returns null.
 */
export const prStatusResolver: ResolverFn = (stage, context) => {
  if (!context.codeHost || !stage.pr_url) {
    return null;
  }

  const status = context.codeHost.getPRStatus(stage.pr_url);

  if (status.merged) return 'Done';
  if (status.hasUnresolvedComments) return 'Addressing Comments';
  return null;
};
```

Key changes from the stub:
- The function is now synchronous (no `async`) because `CodeHostAdapter.getPRStatus` is synchronous.
- Uses `hasUnresolvedComments` (renamed from `hasNewUnresolvedComments`).
- JSDoc updated to reflect production behavior.

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors (the types now align).

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/resolvers/builtins/pr-status.ts
git commit -m "feat(kanban-cli): replace pr-status resolver stub with production implementation"
```

---

### Task 7: Update Existing pr-status Tests to Match New Interface

**Files:**
- Modify: `tools/kanban-cli/tests/resolvers/builtins.test.ts`

The existing tests use `async` and the old `hasNewUnresolvedComments` field. Update them to match the new synchronous `CodeHostAdapter` interface.

**Step 1: Replace the entire contents of `builtins.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import { stageRouterResolver } from '../../src/resolvers/builtins/stage-router.js';
import { registerBuiltinResolvers } from '../../src/resolvers/builtins/index.js';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import type { ResolverStageInput, ResolverContext } from '../../src/resolvers/types.js';

const baseContext: ResolverContext = { env: {} };

describe('prStatusResolver', () => {
  it('returns Done when PR is merged', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: true, hasUnresolvedComments: false, state: 'merged' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('returns Addressing Comments when PR has unresolved comments', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: true, state: 'open' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Addressing Comments');
  });

  it('returns null when no changes', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: false, state: 'open' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });

  it('returns null when no code host available', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const result = prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  it('returns null when no pr_url on stage', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created' };
    const result = prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  it('prioritizes merged over unresolved comments', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: true, hasUnresolvedComments: true, state: 'merged' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });
});

describe('stageRouterResolver', () => {
  it('returns null by default (no routing configured)', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing' };
    const result = stageRouterResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  // Note: The stage-router is a stub. Real routing logic will be configured
  // per-repo by users who create custom resolvers. This built-in is a no-op
  // placeholder that demonstrates the resolver pattern.
});

describe('registerBuiltinResolvers', () => {
  it('registers all built-in resolvers', () => {
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    expect(registry.has('pr-status')).toBe(true);
    expect(registry.has('stage-router')).toBe(true);
  });
});
```

Key changes:
- Removed `async` / `await` from all pr-status tests (the resolver is now synchronous).
- Changed `hasNewUnresolvedComments` to `hasUnresolvedComments` in all mock returns.
- Added a new test case: "prioritizes merged over unresolved comments".

**Step 2: Run all tests**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add tools/kanban-cli/tests/resolvers/builtins.test.ts
git commit -m "test(kanban-cli): update pr-status tests to match new synchronous CodeHostAdapter interface"
```

---

### Task 8: Add pr_url and pr_number Fields to Stage Type

**Files:**
- Modify: `tools/kanban-cli/src/types/work-items.ts` (add `pr_url` and `pr_number` to `Stage`)
- Modify: `tools/kanban-cli/src/parser/frontmatter.ts` (parse the new fields)
- Modify: `tools/kanban-cli/tests/parser/frontmatter.test.ts` (add test cases for the new fields)

**Step 1: Add fields to Stage interface**

In `tools/kanban-cli/src/types/work-items.ts`, add `pr_url` and `pr_number` fields to the `Stage` interface.

Find the existing `Stage` interface and replace it:

```typescript
/**
 * A stage parsed from YAML frontmatter.
 */
export interface Stage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  status: string;
  session_active: boolean;
  refinement_type: string[];
  depends_on: string[];
  worktree_branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  priority: number;
  due_date: string | null;
  file_path: string;
}
```

The only additions are `pr_url: string | null` and `pr_number: number | null`.

**Step 2: Update parseStageFrontmatter**

In `tools/kanban-cli/src/parser/frontmatter.ts`, update `parseStageFrontmatter` to include the new fields.

Find the `return` block in `parseStageFrontmatter` and replace it:

```typescript
export function parseStageFrontmatter(content: string, filePath: string): Stage {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    ticket: requireField<string>(data, 'ticket', filePath),
    epic: requireField<string>(data, 'epic', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    session_active: data.session_active === true ? true : false,
    refinement_type: Array.isArray(data.refinement_type) ? data.refinement_type : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    worktree_branch: (data.worktree_branch as string) ?? null,
    pr_url: (data.pr_url as string) ?? null,
    pr_number: typeof data.pr_number === 'number' ? data.pr_number : null,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    due_date: (data.due_date as string) ?? null,
    file_path: filePath,
  };
}
```

**Step 3: Update frontmatter tests**

Read the existing test file first. Then add test cases for the new fields to `tests/parser/frontmatter.test.ts`.

Add the following test cases inside the existing `parseStageFrontmatter` describe block:

```typescript
  it('parses pr_url when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pr_url: https://github.com/org/repo/pull/42
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_url).toBe('https://github.com/org/repo/pull/42');
  });

  it('defaults pr_url to null when absent', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Build
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_url).toBeNull();
  });

  it('parses pr_number when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pr_number: 42
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_number).toBe(42);
  });

  it('defaults pr_number to null when absent', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Build
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_number).toBeNull();
  });
```

**Step 4: Check for other files that construct Stage objects**

Search for any other code that constructs `Stage` objects (tests, sync, repositories, etc.) and add `pr_url: null` and `pr_number: null` to those constructions so they compile.

Likely affected files (search the codebase for `pr_url` and `Stage` to verify):
- `tools/kanban-cli/tests/parser/frontmatter.test.ts` -- existing test stage objects may need the new fields
- `tools/kanban-cli/src/db/repositories/` -- if stage rows are mapped to Stage objects
- `tools/kanban-cli/tests/` -- any test that builds a Stage literal

For each file that constructs a `Stage` object, add:
```typescript
pr_url: null,
pr_number: null,
```

Also check `tools/kanban-cli/src/db/` for any SQL schema that defines the stages table. If the stages table exists, add the new columns. Search for `CREATE TABLE.*stage` in the db schema files.

**Step 5: Run all tests**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: All tests PASS (including the new ones and all pre-existing tests).

**Step 6: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 7: Commit**

```bash
git add tools/kanban-cli/src/types/work-items.ts tools/kanban-cli/src/parser/frontmatter.ts tools/kanban-cli/tests/parser/frontmatter.test.ts
# Also add any other modified files found in Step 4
git commit -m "feat(kanban-cli): add pr_url and pr_number fields to Stage type and parser"
```

---

### Task 9: Create Code Host Factory and Export New Modules

**Files:**
- Create: `tools/kanban-cli/src/utils/code-host-factory.ts`
- Modify: `tools/kanban-cli/src/index.ts` (add new exports)

**Step 1: Create the factory that picks the right adapter**

Create `tools/kanban-cli/src/utils/code-host-factory.ts`:

```typescript
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
```

**Step 2: Add new exports to index.ts**

Add the following export blocks to `tools/kanban-cli/src/index.ts` (at the end of the file, before any closing comments):

```typescript
// Utils - Git Platform Detection
export type { GitPlatform, DetectPlatformOptions } from './utils/git-platform.js';
export { detectGitPlatform, parsePlatformFromUrl, getGitRemoteUrl } from './utils/git-platform.js';

// Utils - Code Host Adapters
export { createGitHubAdapter } from './utils/code-host-github.js';
export type { GitHubAdapterOptions } from './utils/code-host-github.js';
export { parseGitHubPrUrl } from './utils/code-host-github.js';
export { createGitLabAdapter } from './utils/code-host-gitlab.js';
export type { GitLabAdapterOptions } from './utils/code-host-gitlab.js';
export { parseGitLabMrUrl } from './utils/code-host-gitlab.js';
export { createCodeHostAdapter } from './utils/code-host-factory.js';

// Resolver types (re-export new named types)
export type { PRStatus, CodeHostAdapter } from './resolvers/types.js';
```

**Step 3: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 4: Run all tests**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/utils/code-host-factory.ts tools/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): add code host factory and export git platform utilities"
```

---

### Task 10: Write Integration Test

**Files:**
- Create: `tools/kanban-cli/tests/utils/code-host-factory.test.ts`

This test verifies the end-to-end flow: platform detection -> adapter creation -> resolver execution.

**Step 1: Write the integration test**

Create `tools/kanban-cli/tests/utils/code-host-factory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createCodeHostAdapter } from '../../src/utils/code-host-factory.js';
import { detectGitPlatform } from '../../src/utils/git-platform.js';
import { createGitHubAdapter } from '../../src/utils/code-host-github.js';
import { createGitLabAdapter } from '../../src/utils/code-host-gitlab.js';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import type { ResolverStageInput, ResolverContext } from '../../src/resolvers/types.js';

describe('createCodeHostAdapter', () => {
  it('returns GitHub adapter for github platform', () => {
    const adapter = createCodeHostAdapter('github');
    expect(adapter).not.toBeNull();
  });

  it('returns GitLab adapter for gitlab platform', () => {
    const adapter = createCodeHostAdapter('gitlab');
    expect(adapter).not.toBeNull();
  });

  it('returns null for unknown platform', () => {
    const adapter = createCodeHostAdapter('unknown');
    expect(adapter).toBeNull();
  });
});

describe('end-to-end: platform detection -> adapter -> resolver', () => {
  it('GitHub flow: detects platform, creates adapter, resolves PR merged', () => {
    // 1. Detect platform
    const platform = detectGitPlatform({
      envValue: 'github',
      getRemoteUrl: () => null,
    });
    expect(platform).toBe('github');

    // 2. Create adapter with mock CLI
    const adapter = createGitHubAdapter({
      execFn: () => JSON.stringify({
        state: 'MERGED',
        mergedAt: '2026-02-18T10:00:00Z',
        reviewDecision: 'APPROVED',
        reviews: [],
      }),
    });

    // 3. Run resolver
    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://github.com/org/repo/pull/42',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter,
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('GitLab flow: detects platform, creates adapter, resolves MR with unresolved comments', () => {
    // 1. Detect platform
    const platform = detectGitPlatform({
      getRemoteUrl: () => 'git@gitlab.com:org/repo.git',
    });
    expect(platform).toBe('gitlab');

    // 2. Create adapter with mock CLI
    const adapter = createGitLabAdapter({
      execFn: () => JSON.stringify({
        state: 'opened',
        merged_at: null,
        has_conflicts: false,
        blocking_discussions_resolved: false,
      }),
    });

    // 3. Run resolver
    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://gitlab.com/org/repo/-/merge_requests/7',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter,
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Addressing Comments');
  });

  it('unknown platform: no adapter, resolver returns null', () => {
    const platform = detectGitPlatform({
      getRemoteUrl: () => 'https://bitbucket.org/org/repo.git',
    });
    expect(platform).toBe('unknown');

    const adapter = createCodeHostAdapter(platform);
    expect(adapter).toBeNull();

    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://bitbucket.org/org/repo/pull/1',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter ?? undefined,
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run all tests**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: ALL tests PASS (including all pre-existing 290+ tests and all new tests).

**Step 3: Final verification**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 4: Commit**

```bash
git add tools/kanban-cli/tests/utils/code-host-factory.test.ts
git commit -m "test(kanban-cli): add integration test for platform detection -> adapter -> resolver flow"
```

---

### Completion Checklist

| # | Task | Files | Tests |
|---|------|-------|-------|
| 1 | GitPlatform type + CodeHostAdapter interface | `src/utils/git-platform.ts`, `src/resolvers/types.ts` | -- |
| 2 | Git platform detection tests | `tests/utils/git-platform.test.ts` | 18 tests |
| 3 | GitHub code host adapter | `src/utils/code-host-github.ts` | -- |
| 4 | GitLab code host adapter | `src/utils/code-host-gitlab.ts` | -- |
| 5 | Code host adapter tests | `tests/utils/code-host-github.test.ts`, `tests/utils/code-host-gitlab.test.ts` | ~12 tests |
| 6 | Update pr-status resolver | `src/resolvers/builtins/pr-status.ts` | -- |
| 7 | Update existing pr-status tests | `tests/resolvers/builtins.test.ts` | 6 tests (updated) |
| 8 | Add pr_url/pr_number to Stage | `src/types/work-items.ts`, `src/parser/frontmatter.ts`, `tests/parser/frontmatter.test.ts` | 4 new tests |
| 9 | Code host factory + exports | `src/utils/code-host-factory.ts`, `src/index.ts` | -- |
| 10 | Integration test | `tests/utils/code-host-factory.test.ts` | 6 tests |

**Total new tests:** ~46

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes (all pre-existing + new tests)
- [ ] `npm run verify` passes
- [ ] Each task committed incrementally
