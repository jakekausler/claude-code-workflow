import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml, stringify as yamlStringify } from 'yaml';

// ── Schemas ──────────────────────────────────────────────────────────

export const repoEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  slack_webhook: z.string().url().optional(),
});

export const reposConfigSchema = z.object({
  repos: z.array(repoEntrySchema).default([]),
});

// ── Types ────────────────────────────────────────────────────────────

export type RepoEntry = z.infer<typeof repoEntrySchema>;

export interface RegistryDeps {
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => void;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
  registryPath: string;
}

export interface RepoRegistry {
  loadRepos(): RepoEntry[];
  registerRepo(entry: RepoEntry): void;
  unregisterRepo(name: string): void;
  findByName(name: string): RepoEntry | null;
}

// ── Default deps ─────────────────────────────────────────────────────

const DEFAULT_REGISTRY_PATH = path.join(
  os.homedir(),
  '.config',
  'kanban-workflow',
  'repos.yaml',
);

function defaultDeps(): RegistryDeps {
  return {
    readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
    existsSync: (p: string) => fs.existsSync(p),
    mkdirSync: (p: string, opts?: { recursive: boolean }) =>
      fs.mkdirSync(p, opts),
    registryPath: DEFAULT_REGISTRY_PATH,
  };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createRegistry(
  overrides: Partial<RegistryDeps> = {},
): RepoRegistry {
  const deps: RegistryDeps = { ...defaultDeps(), ...overrides };

  function loadRepos(): RepoEntry[] {
    if (!deps.existsSync(deps.registryPath)) {
      return [];
    }

    const raw = deps.readFile(deps.registryPath);
    const parsed = parseYaml(raw);
    const result = reposConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid repos config at ${deps.registryPath}: ${result.error.issues.map((i) => i.message).join(', ')}`,
      );
    }

    return result.data.repos;
  }

  function writeRepos(repos: RepoEntry[]): void {
    const dir = path.dirname(deps.registryPath);
    deps.mkdirSync(dir, { recursive: true });
    const content = yamlStringify({ repos });
    deps.writeFile(deps.registryPath, content);
  }

  function registerRepo(entry: RepoEntry): void {
    // Validate the incoming entry against schema
    const validated = repoEntrySchema.parse(entry);

    const existing = loadRepos();

    if (existing.some((r) => r.name === validated.name)) {
      throw new Error(
        `Duplicate name: repo "${validated.name}" is already registered`,
      );
    }

    if (existing.some((r) => r.path === validated.path)) {
      throw new Error(
        `Duplicate path: "${validated.path}" is already registered`,
      );
    }

    existing.push(validated);
    writeRepos(existing);
  }

  function unregisterRepo(name: string): void {
    const existing = loadRepos();
    const index = existing.findIndex((r) => r.name === name);

    if (index === -1) {
      throw new Error(`Repo "${name}" not found`);
    }

    existing.splice(index, 1);
    writeRepos(existing);
  }

  function findByName(name: string): RepoEntry | null {
    const repos = loadRepos();
    return repos.find((r) => r.name === name) ?? null;
  }

  return { loadRepos, registerRepo, unregisterRepo, findByName };
}
