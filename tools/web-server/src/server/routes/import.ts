import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import matter from 'gray-matter';

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

const importBodySchema = z.object({
  provider: z.enum(['github', 'gitlab']),
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

const importPlugin: FastifyPluginCallback = (app, _opts, done) => {
  // GET /api/import/github/issues
  app.get('/api/import/github/issues', async (request, reply) => {
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
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const msg = await res.text();
        return reply.status(res.status).send({ error: `GitHub API error: ${msg}` });
      }
      const raw = await res.json() as Array<Record<string, unknown>>;
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
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // GET /api/import/gitlab/issues
  app.get('/api/import/gitlab/issues', async (request, reply) => {
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
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const msg = await res.text();
        return reply.status(res.status).send({ error: `GitLab API error: ${msg}` });
      }
      const raw = await res.json() as Array<Record<string, unknown>>;
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
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // POST /api/import/issues — create ticket files
  app.post('/api/import/issues', async (request, reply) => {
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
    const repos = app.dataService.repos.findAll();
    if (repos.length > 0) {
      const repo = repos[0];
      if (repo.path) {
        ticketsDir = join(repo.path, 'tickets');
      } else {
        // Fall back to first ticket's file_path
        const tickets = app.dataService.tickets.listByRepo(repo.id);
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
