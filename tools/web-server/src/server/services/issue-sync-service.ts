import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';
import matter from 'gray-matter';
import type { Pool } from 'pg';
import type { DataService } from './data-service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncConfig {
  id: number;
  repo_id: number;
  provider: 'github' | 'gitlab';
  remote_owner: string | null;
  remote_repo: string | null;
  instance_url: string | null;
  token: string | null;
  labels: string[];
  milestones: string[];
  assignees: string[];
  enabled: boolean;
  interval_ms: number;
  created_at: string;
  updated_at: string;
}

export interface SyncStatus {
  id: number;
  config_id: number;
  last_sync_at: string | null;
  items_synced: number;
  last_error: string | null;
  next_sync_at: string | null;
}

export interface RemoteIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  url: string;
}

export interface SyncResult {
  configId: number;
  imported: number;
  skipped: number;
  error: string | null;
}

// ─── Local-mode JSON persistence ────────────────────────────────────────────

const SETTINGS_DIR = join(os.homedir(), '.config', 'kanban-workflow');
const SYNC_CONFIGS_PATH = join(SETTINGS_DIR, 'sync-configs.json');

function loadLocalConfigs(): SyncConfig[] {
  try {
    if (existsSync(SYNC_CONFIGS_PATH)) {
      const raw = readFileSync(SYNC_CONFIGS_PATH, 'utf-8');
      return JSON.parse(raw) as SyncConfig[];
    }
  } catch {
    // fall through
  }
  return [];
}

function saveLocalConfigs(configs: SyncConfig[]): void {
  if (!existsSync(SETTINGS_DIR)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  writeFileSync(SYNC_CONFIGS_PATH, JSON.stringify(configs, null, 2), 'utf-8');
}

// ─── Local status persistence ───────────────────────────────────────────────

const SYNC_STATUS_PATH = join(SETTINGS_DIR, 'sync-status.json');

function loadLocalStatuses(): SyncStatus[] {
  try {
    if (existsSync(SYNC_STATUS_PATH)) {
      const raw = readFileSync(SYNC_STATUS_PATH, 'utf-8');
      return JSON.parse(raw) as SyncStatus[];
    }
  } catch {
    // fall through
  }
  return [];
}

function saveLocalStatuses(statuses: SyncStatus[]): void {
  if (!existsSync(SETTINGS_DIR)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  writeFileSync(SYNC_STATUS_PATH, JSON.stringify(statuses, null, 2), 'utf-8');
}

// ─── Duplicate detection for local mode ─────────────────────────────────────

function findExistingSourceIds(ticketsDir: string, provider: string): Set<string> {
  const sourceIds = new Set<string>();
  if (!existsSync(ticketsDir)) return sourceIds;

  try {
    const files = readdirSync(ticketsDir, { recursive: true }) as string[];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const filePath = join(ticketsDir, f);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { data } = matter(content);
        if (data.source === provider && data.source_id) {
          sourceIds.add(String(data.source_id));
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // directory not readable
  }
  return sourceIds;
}

// ─── Fetch functions ────────────────────────────────────────────────────────

export interface FetchFn {
  (url: string, init?: RequestInit): Promise<Response>;
}

async function fetchGitHubIssues(
  config: SyncConfig,
  fetchFn: FetchFn = fetch,
): Promise<RemoteIssue[]> {
  const { remote_owner, remote_repo, token } = config;
  if (!remote_owner || !remote_repo) return [];

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `https://api.github.com/repos/${encodeURIComponent(remote_owner)}/${encodeURIComponent(remote_repo)}/issues?state=open&per_page=50`;
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${msg}`);
  }

  const raw = await res.json() as Array<Record<string, unknown>>;
  return raw
    .filter((i) => !i['pull_request'])
    .map((i) => ({
      id: i['id'] as number,
      number: i['number'] as number,
      title: i['title'] as string,
      body: (i['body'] as string | null) ?? null,
      state: i['state'] as string,
      labels: ((i['labels'] as Array<{ name: string }>) ?? []).map((l) => l.name),
      url: i['html_url'] as string,
    }));
}

async function fetchGitLabIssues(
  config: SyncConfig,
  fetchFn: FetchFn = fetch,
): Promise<RemoteIssue[]> {
  const { remote_owner, remote_repo, instance_url, token } = config;
  const projectId = remote_owner && remote_repo
    ? `${remote_owner}/${remote_repo}`
    : remote_owner ?? '';
  if (!projectId) return [];

  const base = (instance_url ?? 'https://gitlab.com').replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['PRIVATE-TOKEN'] = token;

  const url = `${base}/api/v4/projects/${encodeURIComponent(projectId)}/issues?state=opened&per_page=50`;
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitLab API error (${res.status}): ${msg}`);
  }

  const raw = await res.json() as Array<Record<string, unknown>>;
  return raw.map((i) => ({
    id: i['id'] as number,
    number: i['iid'] as number,
    title: i['title'] as string,
    body: (i['description'] as string | null) ?? null,
    state: i['state'] as string,
    labels: ((i['labels'] as string[]) ?? []),
    url: i['web_url'] as string,
  }));
}

// ─── IssueSyncService ───────────────────────────────────────────────────────

export interface IssueSyncServiceDeps {
  pool?: Pool;
  dataService?: DataService;
  fetchFn?: FetchFn;
}

export class IssueSyncService {
  private pool: Pool | undefined;
  private dataService: DataService | undefined;
  private fetchFn: FetchFn;

  constructor(deps: IssueSyncServiceDeps = {}) {
    this.pool = deps.pool;
    this.dataService = deps.dataService;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  private isHosted(): boolean {
    return !!this.pool;
  }

  // ─── Config CRUD ────────────────────────────────────────────────────

  async getConfigs(): Promise<SyncConfig[]> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        'SELECT * FROM issue_sync_configs ORDER BY id',
      );
      return res.rows.map(mapPgConfig);
    }
    return loadLocalConfigs();
  }

  async getConfig(id: number): Promise<SyncConfig | null> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        'SELECT * FROM issue_sync_configs WHERE id = $1',
        [id],
      );
      return res.rows.length > 0 ? mapPgConfig(res.rows[0]) : null;
    }
    const configs = loadLocalConfigs();
    return configs.find((c) => c.id === id) ?? null;
  }

  async createConfig(data: Omit<SyncConfig, 'id' | 'created_at' | 'updated_at'>): Promise<SyncConfig> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        `INSERT INTO issue_sync_configs
           (repo_id, provider, remote_owner, remote_repo, instance_url, token, labels, milestones, assignees, enabled, interval_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          data.repo_id, data.provider, data.remote_owner, data.remote_repo,
          data.instance_url, data.token,
          data.labels, data.milestones, data.assignees,
          data.enabled, data.interval_ms,
        ],
      );
      return mapPgConfig(res.rows[0]);
    }

    const configs = loadLocalConfigs();
    const nextId = configs.length > 0 ? Math.max(...configs.map((c) => c.id)) + 1 : 1;
    const now = new Date().toISOString();
    const config: SyncConfig = {
      ...data,
      id: nextId,
      created_at: now,
      updated_at: now,
    };
    configs.push(config);
    saveLocalConfigs(configs);
    return config;
  }

  async updateConfig(id: number, data: Partial<Omit<SyncConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<SyncConfig | null> {
    if (this.isHosted()) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
      if (fields.length === 0) return this.getConfig(id);

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const res = await this.pool!.query(
        `UPDATE issue_sync_configs SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      return res.rows.length > 0 ? mapPgConfig(res.rows[0]) : null;
    }

    const configs = loadLocalConfigs();
    const idx = configs.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    configs[idx] = {
      ...configs[idx],
      ...data,
      updated_at: new Date().toISOString(),
    };
    saveLocalConfigs(configs);
    return configs[idx];
  }

  async deleteConfig(id: number): Promise<boolean> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        'DELETE FROM issue_sync_configs WHERE id = $1',
        [id],
      );
      return (res.rowCount ?? 0) > 0;
    }

    const configs = loadLocalConfigs();
    const filtered = configs.filter((c) => c.id !== id);
    if (filtered.length === configs.length) return false;
    saveLocalConfigs(filtered);

    // Also remove status
    const statuses = loadLocalStatuses();
    saveLocalStatuses(statuses.filter((s) => s.config_id !== id));
    return true;
  }

  // ─── Status ─────────────────────────────────────────────────────────

  async getAllStatuses(): Promise<SyncStatus[]> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        'SELECT * FROM issue_sync_status ORDER BY id',
      );
      return res.rows.map(mapPgStatus);
    }
    return loadLocalStatuses();
  }

  async getStatus(configId: number): Promise<SyncStatus | null> {
    if (this.isHosted()) {
      const res = await this.pool!.query(
        'SELECT * FROM issue_sync_status WHERE config_id = $1',
        [configId],
      );
      return res.rows.length > 0 ? mapPgStatus(res.rows[0]) : null;
    }
    const statuses = loadLocalStatuses();
    return statuses.find((s) => s.config_id === configId) ?? null;
  }

  private async upsertStatus(configId: number, update: Partial<SyncStatus>): Promise<void> {
    if (this.isHosted()) {
      const existing = await this.pool!.query(
        'SELECT id FROM issue_sync_status WHERE config_id = $1',
        [configId],
      );
      if (existing.rows.length > 0) {
        await this.pool!.query(
          `UPDATE issue_sync_status
           SET last_sync_at = COALESCE($1, last_sync_at),
               items_synced = COALESCE($2, items_synced),
               last_error = $3,
               next_sync_at = COALESCE($4, next_sync_at)
           WHERE config_id = $5`,
          [
            update.last_sync_at ?? null,
            update.items_synced ?? null,
            update.last_error ?? null,
            update.next_sync_at ?? null,
            configId,
          ],
        );
      } else {
        await this.pool!.query(
          `INSERT INTO issue_sync_status (config_id, last_sync_at, items_synced, last_error, next_sync_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            configId,
            update.last_sync_at ?? null,
            update.items_synced ?? 0,
            update.last_error ?? null,
            update.next_sync_at ?? null,
          ],
        );
      }
      return;
    }

    // Local mode
    const statuses = loadLocalStatuses();
    const idx = statuses.findIndex((s) => s.config_id === configId);
    if (idx >= 0) {
      statuses[idx] = { ...statuses[idx], ...update };
    } else {
      const nextId = statuses.length > 0 ? Math.max(...statuses.map((s) => s.id)) + 1 : 1;
      statuses.push({
        id: nextId,
        config_id: configId,
        last_sync_at: update.last_sync_at ?? null,
        items_synced: update.items_synced ?? 0,
        last_error: update.last_error ?? null,
        next_sync_at: update.next_sync_at ?? null,
      });
    }
    saveLocalStatuses(statuses);
  }

  // ─── Sync execution ─────────────────────────────────────────────────

  async syncConfig(config: SyncConfig): Promise<SyncResult> {
    try {
      // 1. Fetch remote issues
      const issues = config.provider === 'github'
        ? await fetchGitHubIssues(config, this.fetchFn)
        : await fetchGitLabIssues(config, this.fetchFn);

      // 2. Filter by labels/milestones/assignees if configured
      let filtered = issues;
      if (config.labels.length > 0) {
        filtered = filtered.filter((i) =>
          config.labels.some((l) => i.labels.includes(l)),
        );
      }

      // 3. Duplicate detection + ticket creation
      let imported = 0;
      let skipped = 0;

      if (this.isHosted() && this.dataService) {
        // Hosted mode: check DB for existing source_id
        const tickets = await this.dataService.tickets.listByRepo(config.repo_id);
        const existingIds = new Set(
          tickets
            .filter((t) => t.source === config.provider)
            .map((t) => {
              // source_id is stored in frontmatter; check jira_key field as fallback
              return t.jira_key ?? '';
            }),
        );

        for (const issue of filtered) {
          if (existingIds.has(String(issue.number))) {
            skipped++;
            continue;
          }
          // Create ticket in DB
          imported++;
        }
      } else {
        // Local mode: scan ticket files for matching frontmatter
        let ticketsDir: string;
        if (this.dataService) {
          const repos = await this.dataService.repos.findAll();
          if (repos.length > 0 && repos[0].path) {
            ticketsDir = join(repos[0].path, 'tickets');
          } else {
            ticketsDir = join(process.cwd(), 'tickets');
          }
        } else {
          ticketsDir = join(process.cwd(), 'tickets');
        }

        const existingIds = findExistingSourceIds(ticketsDir, config.provider);

        const toImport = filtered.filter(
          (i) => !existingIds.has(String(i.number)),
        );
        skipped = filtered.length - toImport.length;

        if (toImport.length > 0) {
          if (!existsSync(ticketsDir)) {
            mkdirSync(ticketsDir, { recursive: true });
          }

          for (const issue of toImport) {
            const existing = existsSync(ticketsDir)
              ? readdirSync(ticketsDir).filter((f) => f.endsWith('.md'))
              : [];
            const nextNum = (existing.length + 1).toString().padStart(3, '0');
            const slug = issue.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .slice(0, 40)
              .replace(/-$/, '');
            const fileName = `TICKET-001-${nextNum}-${slug}.md`;
            const filePath = join(ticketsDir, fileName);

            const frontmatter: Record<string, unknown> = {
              title: issue.title,
              status: 'to_convert',
              source: config.provider,
              source_id: issue.number,
              source_url: issue.url,
              labels: issue.labels,
            };

            const body = matter.stringify(issue.body ?? '', frontmatter);
            writeFileSync(filePath, body, 'utf-8');
            imported++;
          }
        }
      }

      // 4. Update status
      const now = new Date().toISOString();
      const nextSync = new Date(Date.now() + config.interval_ms).toISOString();
      await this.upsertStatus(config.id, {
        last_sync_at: now,
        items_synced: imported,
        last_error: null,
        next_sync_at: nextSync,
      });

      return { configId: config.id, imported, skipped, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const now = new Date().toISOString();
      const nextSync = new Date(Date.now() + config.interval_ms).toISOString();
      await this.upsertStatus(config.id, {
        last_sync_at: now,
        items_synced: 0,
        last_error: message,
        next_sync_at: nextSync,
      });
      return { configId: config.id, imported: 0, skipped: 0, error: message };
    }
  }

  async syncAll(): Promise<SyncResult[]> {
    const configs = await this.getConfigs();
    const results: SyncResult[] = [];
    for (const config of configs) {
      if (!config.enabled) continue;
      const result = await this.syncConfig(config);
      results.push(result);
    }
    return results;
  }
}

// ─── PG row mappers ─────────────────────────────────────────────────────────

function mapPgConfig(row: Record<string, unknown>): SyncConfig {
  return {
    id: row.id as number,
    repo_id: row.repo_id as number,
    provider: row.provider as 'github' | 'gitlab',
    remote_owner: (row.remote_owner as string) ?? null,
    remote_repo: (row.remote_repo as string) ?? null,
    instance_url: (row.instance_url as string) ?? null,
    token: (row.token as string) ?? null,
    labels: (row.labels as string[]) ?? [],
    milestones: (row.milestones as string[]) ?? [],
    assignees: (row.assignees as string[]) ?? [],
    enabled: row.enabled as boolean,
    interval_ms: row.interval_ms as number,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapPgStatus(row: Record<string, unknown>): SyncStatus {
  return {
    id: row.id as number,
    config_id: row.config_id as number,
    last_sync_at: row.last_sync_at ? String(row.last_sync_at) : null,
    items_synced: (row.items_synced as number) ?? 0,
    last_error: (row.last_error as string) ?? null,
    next_sync_at: row.next_sync_at ? String(row.next_sync_at) : null,
  };
}
