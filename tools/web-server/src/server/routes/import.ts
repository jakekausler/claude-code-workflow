import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';
import matter from 'gray-matter';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';
import { requireRole } from '../deployment/hosted/rbac/rbac-middleware.js';
import { withApiSegment } from '../services/newrelic-instrumentation.js';

export interface ImportRouteOptions {
  roleService?: RoleService;
}

// ─── Jira filter types (inlined — web-server has no dep on kanban-cli) ────────

export interface JiraFilterConfig {
  labels: string[];
  statuses: string[];
  assignee: string | null;
  custom_fields: Record<string, unknown>;
  logic: 'AND' | 'OR';
  jql_override: string | null;
}

const DEFAULT_JIRA_FILTER_CONFIG: JiraFilterConfig = {
  labels: ['claude-workflow'],
  statuses: ['To Do', 'Ready for Dev'],
  assignee: null,
  custom_fields: {},
  logic: 'AND',
  jql_override: null,
};

/**
 * Build a JQL query string from a JiraFilterConfig.
 * If jql_override is set it is returned as-is.
 */
function buildJqlFromFilter(filter: JiraFilterConfig): string {
  if (filter.jql_override) return filter.jql_override;

  const clauses: string[] = [];

  if (filter.labels.length > 0) {
    clauses.push(`labels in (${filter.labels.map((l) => `"${l}"`).join(', ')})`);
  }
  if (filter.statuses.length > 0) {
    clauses.push(`status in (${filter.statuses.map((s) => `"${s}"`).join(', ')})`);
  }
  if (filter.assignee) {
    clauses.push(`assignee = "${filter.assignee}"`);
  }
  for (const [k, v] of Object.entries(filter.custom_fields)) {
    clauses.push(`cf[${k}] = "${String(v)}"`);
  }

  return clauses.join(` ${filter.logic} `) || 'ORDER BY created DESC';
}

// ─── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_DIR = join(os.homedir(), '.config', 'kanban-workflow');
const JIRA_FILTER_SETTINGS_PATH = join(SETTINGS_DIR, 'jira-filters.json');

function loadJiraFilterConfig(): JiraFilterConfig {
  try {
    if (existsSync(JIRA_FILTER_SETTINGS_PATH)) {
      const raw = readFileSync(JIRA_FILTER_SETTINGS_PATH, 'utf-8');
      return { ...DEFAULT_JIRA_FILTER_CONFIG, ...(JSON.parse(raw) as Partial<JiraFilterConfig>) };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_JIRA_FILTER_CONFIG };
}

function saveJiraFilterConfig(config: JiraFilterConfig): void {
  if (!existsSync(SETTINGS_DIR)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  writeFileSync(JIRA_FILTER_SETTINGS_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const githubQuerySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  token: z.string().optional(),
});

const gitlabQuerySchema = z.object({
  projectId: z.string().min(1),
  state: z.enum(['opened', 'closed', 'all']).optional().default('opened'),
  instanceUrl: z.string().optional().default('https://gitlab.com'),
  token: z.string().optional(),
});

const jiraQuerySchema = z.object({
  instanceUrl: z.string().url(),
  projectKey: z.string().min(1),
  email: z.string().email(),
  apiToken: z.string().min(1),
});

const jiraFilterBodySchema = z.object({
  labels: z.array(z.string()).default([]),
  statuses: z.array(z.string()).default([]),
  assignee: z.string().nullable().default(null),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
  logic: z.enum(['AND', 'OR']).default('AND'),
  jql_override: z.string().nullable().default(null),
});

const importBodySchema = z.object({
  provider: z.enum(['github', 'gitlab', 'jira']),
  issues: z.array(z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.string(),
    labels: z.array(z.string()),
    url: z.string(),
  })),
  epicId: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface RemoteIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  url: string;
}

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

// ─── Routes ───────────────────────────────────────────────────────────────────

const importPlugin: FastifyPluginCallback<ImportRouteOptions> = (app, opts, done) => {
  const { roleService } = opts;

  // Config-level routes (fetch issues for display) require Developer role
  const fetchOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  // Import trigger requires Developer role
  const importOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  // GET /api/import/github/issues
  app.get('/api/import/github/issues', fetchOpts, async (request, reply) => {
    const parseResult = githubQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }
    const { owner, repo, state, token } = parseResult.data;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=50`;
      const raw = await withApiSegment('GitHubAPI:listIssues', async () => {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const msg = await res.text();
          throw Object.assign(new Error(`GitHub API error: ${msg}`), { status: res.status });
        }
        return res.json() as Promise<Array<Record<string, unknown>>>;
      });
      const issues: RemoteIssue[] = raw
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

      return reply.send({ issues });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      return reply.status(status ?? 500).send({ error: String(err) });
    }
  });

  // GET /api/import/gitlab/issues
  app.get('/api/import/gitlab/issues', fetchOpts, async (request, reply) => {
    const parseResult = gitlabQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }
    const { projectId, state, instanceUrl, token } = parseResult.data;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['PRIVATE-TOKEN'] = token;

    try {
      const base = instanceUrl.replace(/\/$/, '');
      const url = `${base}/api/v4/projects/${encodeURIComponent(projectId)}/issues?state=${state}&per_page=50`;
      const raw = await withApiSegment('GitLabAPI:listIssues', async () => {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const msg = await res.text();
          throw Object.assign(new Error(`GitLab API error: ${msg}`), { status: res.status });
        }
        return res.json() as Promise<Array<Record<string, unknown>>>;
      });
      const issues: RemoteIssue[] = raw.map((i) => ({
        id: i['id'] as number,
        number: i['iid'] as number,
        title: i['title'] as string,
        body: (i['description'] as string | null) ?? null,
        state: i['state'] as string,
        labels: ((i['labels'] as string[]) ?? []),
        url: i['web_url'] as string,
      }));

      return reply.send({ issues });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      return reply.status(status ?? 500).send({ error: String(err) });
    }
  });

  // GET /api/import/jira/issues — applies saved JiraFilterConfig to build the JQL query
  app.get('/api/import/jira/issues', fetchOpts, async (request, reply) => {
    const parseResult = jiraQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }
    const { instanceUrl, projectKey, email, apiToken } = parseResult.data;

    const base64Auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const headers: Record<string, string> = {
      'Authorization': `Basic ${base64Auth}`,
      'Accept': 'application/json',
    };

    try {
      const base = instanceUrl.replace(/\/$/, '');

      // Build JQL from saved filter config, scoped to the project
      const filterConfig = loadJiraFilterConfig();
      const filterJql = buildJqlFromFilter(filterConfig);
      const jql = filterJql === 'ORDER BY created DESC'
        ? `project=${encodeURIComponent(projectKey)}`
        : `project=${encodeURIComponent(projectKey)} AND (${filterJql})`;

      const url = `${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50`;
      const raw = await withApiSegment('JiraAPI:searchIssues', async () => {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const msg = await res.text();
          throw Object.assign(new Error(`Jira API error: ${msg}`), { status: res.status });
        }
        return res.json() as Promise<{
          issues: Array<{
            id: string;
            key: string;
            fields: {
              summary: string;
              description: unknown;
              status: { name: string };
              labels: string[];
            };
          }>;
        }>;
      });
      const issues: RemoteIssue[] = raw.issues.map((issue) => ({
        id: parseInt(issue.id),
        number: parseInt(issue.id),
        title: issue.fields.summary,
        body: typeof issue.fields.description === 'string'
          ? issue.fields.description
          : issue.fields.description ? JSON.stringify(issue.fields.description) : null,
        state: issue.fields.status.name,
        labels: issue.fields.labels ?? [],
        url: `${base}/browse/${issue.key}`,
      }));

      return reply.send({ issues });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      return reply.status(status ?? 500).send({ error: String(err) });
    }
  });

  // GET /api/settings/jira/filters — return current JiraFilterConfig
  app.get('/api/settings/jira/filters', async (_request, reply) => {
    return reply.send(loadJiraFilterConfig());
  });

  // PUT /api/settings/jira/filters — save JiraFilterConfig
  app.put('/api/settings/jira/filters', async (request, reply) => {
    const parseResult = jiraFilterBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid filter config', details: parseResult.error.issues });
    }
    const config: JiraFilterConfig = parseResult.data;
    try {
      saveJiraFilterConfig(config);
      return reply.send(config);
    } catch (err) {
      return reply.status(500).send({ error: `Failed to save filter config: ${String(err)}` });
    }
  });

  // POST /api/import/issues — create ticket files
  app.post('/api/import/issues', importOpts, async (request, reply) => {
    // Filesystem operations not supported in hosted mode
    if (app.deploymentContext.mode === 'hosted') {
      return reply.code(501).send({ error: 'Not supported in hosted mode' });
    }

    const parseResult = importBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }

    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const { provider, issues, epicId } = parseResult.data;

    // Determine tickets directory from the repo data
    let ticketsDir: string;
    const repos = await app.dataService.repos.findAll();
    if (repos.length > 0) {
      const repo = repos[0];
      if (repo.path) {
        ticketsDir = join(repo.path, 'tickets');
      } else {
        // Fall back to first ticket's file_path
        const tickets = await app.dataService.tickets.listByRepo(repo.id);
        if (tickets.length > 0 && tickets[0].file_path) {
          ticketsDir = dirname(tickets[0].file_path);
        } else {
          ticketsDir = join(process.cwd(), 'tickets');
        }
      }
    } else {
      ticketsDir = join(process.cwd(), 'tickets');
    }

    // Check for duplicates
    const existingIds = findExistingSourceIds(ticketsDir, provider);
    const toImport = issues.filter((i) => !existingIds.has(String(i.number)));

    if (toImport.length === 0) {
      return reply.send({ imported: 0, skipped: issues.length, files: [] });
    }

    if (!existsSync(ticketsDir)) {
      mkdirSync(ticketsDir, { recursive: true });
    }

    const files: string[] = [];
    let imported = 0;

    for (const issue of toImport) {
      const existing = existsSync(ticketsDir) ? readdirSync(ticketsDir).filter((f) => f.endsWith('.md')) : [];
      const nextNum = (existing.length + 1).toString().padStart(3, '0');
      const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
      const fileName = `TICKET-001-${nextNum}-${slug}.md`;
      const filePath = join(ticketsDir, fileName);

      const frontmatter: Record<string, unknown> = {
        title: issue.title,
        status: 'to_convert',
        source: provider,
        source_id: issue.number,
        source_url: issue.url,
        labels: issue.labels,
      };
      if (epicId) frontmatter['epic_id'] = epicId;

      const body = matter.stringify(issue.body ?? '', frontmatter);
      writeFileSync(filePath, body, 'utf-8');
      files.push(filePath);
      imported++;
    }

    return reply.send({ imported, skipped: issues.length - imported, files });
  });

  done();
};

export const importRoutes = fp(importPlugin, { name: 'import-routes' });
