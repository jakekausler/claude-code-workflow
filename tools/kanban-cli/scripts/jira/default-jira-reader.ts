#!/usr/bin/env tsx

/**
 * Default Jira reader wrapper script.
 *
 * Reads JSON from stdin, validates the operation field, and delegates to
 * atlassian-tools CLI scripts. Reshapes the output to match the kanban-cli
 * JSON contract.
 *
 * Supported operations:
 *   - get-ticket:      fetch a single ticket by key
 *   - search-tickets:  search tickets via JQL
 *
 * Error output: JSON on stderr with { error, code } fields.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const AT_PATH = '/home/jakekausler/.claude/plugins/cache/claude-code-marketplace/atlassian-tools/1.4.0';

// ─── Stdin helpers ────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function exitWithError(message: string, code: string): never {
  process.stderr.write(JSON.stringify({ error: message, code }));
  process.exit(1);
  throw new Error('unreachable');
}

// ─── Spawning helper ─────────────────────────────────────────────────────────

function spawnScript(
  scriptPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: AT_PATH,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });

    // Close stdin immediately (these scripts read from CLI args, not stdin)
    child.stdin.end();
  });
}

// ─── ADF to text ──────────────────────────────────────────────────────────────

// Known limitation: This simplified ADF-to-text converter only handles text, paragraph,
// heading, and hardBreak nodes. Complex Jira descriptions with lists, code blocks, tables,
// or blockquotes will have degraded content. For full ADF conversion, consider using
// atlassian-tools' adf-converter.ts module directly.

/**
 * Simple ADF-to-text extractor. Walks the ADF node tree and concatenates
 * text nodes, separating block-level nodes with newlines.
 *
 * This mirrors the adfToText function from atlassian-tools' adf-converter.ts.
 */
function adfToText(adf: any): string | null {
  if (!adf || typeof adf !== 'object') {
    return null;
  }

  if (!('content' in adf) || !Array.isArray(adf.content)) {
    return null;
  }

  const lines: string[] = [];

  function traverse(node: any): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.type === 'paragraph' && node.content) {
      const text = node.content.map(traverse).join('');
      if (text.trim()) {
        lines.push(text);
      }
      return '';
    }

    if (node.type === 'heading' && node.content) {
      const text = node.content.map(traverse).join('');
      if (text.trim()) {
        lines.push(text);
      }
      return '';
    }

    if (node.type === 'hardBreak') {
      return '\n';
    }

    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }

    return '';
  }

  adf.content.forEach(traverse);

  const result = lines.join('\n');
  return result.trim() || null;
}

// ─── Auth helper for direct API calls ─────────────────────────────────────────

interface JiraCredentials {
  email: string;
  token: string;
  baseUrl: string;
}

/**
 * Load Jira credentials by dynamically importing the atlassian-tools auth helper.
 * Falls back to environment variables if the import fails.
 * Returns null if credentials are unavailable (caller should degrade gracefully).
 */
async function getCredentials(): Promise<JiraCredentials | null> {
  try {
    const authModule = await import(`${AT_PATH}/lib/auth-helper.js`);
    return authModule.getCredentials();
  } catch {
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_TOKEN;
    const baseUrl = process.env.JIRA_BASE_URL;

    if (email && token && baseUrl) {
      return { email, token, baseUrl };
    }

    return null;
  }
}

function encodeAuth(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

// ─── Link types ──────────────────────────────────────────────────────────────

// Mirrors jiraLinkSchema in src/parser/frontmatter-schemas.ts.
// Changes to the schema should be reflected here.
interface JiraLink {
  type: 'confluence' | 'jira_issue' | 'attachment' | 'external';
  url: string;
  title: string;
  key?: string;
  relationship?: string;
  filename?: string;
  mime_type?: string;
}

/**
 * Determine whether a URL points to a Confluence wiki page.
 */
function isConfluenceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.atlassian.net') && parsed.pathname.includes('/wiki/');
  } catch {
    return false;
  }
}

/**
 * Extract links from the Jira issue fields and remote links API.
 *
 * Collects from three sources:
 *   1. fields.issuelinks[] — inward/outward Jira issue relationships
 *   2. fields.attachment[] — file attachments
 *   3. /rest/api/3/issue/{key}/remotelink — Confluence pages and external URLs
 *
 * If any source is missing or fails, the other sources still contribute.
 * The function never throws; on total failure it returns [].
 */
async function extractLinks(key: string, fields: any): Promise<JiraLink[]> {
  const links: JiraLink[] = [];

  try {
    // Fetch credentials once for use in browse URLs and remote links API.
    const creds = await getCredentials();

    // 1. Issue links (inward/outward Jira issues)
    const issueLinks: any[] = fields.issuelinks ?? [];
    for (const link of issueLinks) {
      if (link.outwardIssue) {
        const issue = link.outwardIssue;
        links.push({
          type: 'jira_issue',
          url: creds ? `${creds.baseUrl}/browse/${issue.key}` : (issue.self ?? ''),
          title: issue.fields?.summary ?? issue.key ?? '',
          key: issue.key,
          relationship: link.type?.outward ?? link.type?.name ?? '',
        });
      } else if (link.inwardIssue) {
        const issue = link.inwardIssue;
        links.push({
          type: 'jira_issue',
          url: creds ? `${creds.baseUrl}/browse/${issue.key}` : (issue.self ?? ''),
          title: issue.fields?.summary ?? issue.key ?? '',
          key: issue.key,
          relationship: link.type?.inward ?? link.type?.name ?? '',
        });
      }
    }

    // 2. Attachments
    const attachments: any[] = fields.attachment ?? [];
    for (const att of attachments) {
      links.push({
        type: 'attachment',
        url: att.content ?? '',
        title: att.filename ?? `attachment-${att.id ?? 'unknown'}`,
        filename: att.filename,
        mime_type: att.mimeType,
      });
    }

    // 3. Remote links (Confluence pages, external URLs)
    try {
      if (creds) {
        const url = `${creds.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Basic ${encodeAuth(creds.email, creds.token)}`,
              'Accept': 'application/json',
            },
            signal: controller.signal,
          });

          if (response.ok) {
            const body = await response.json();
            const remoteLinks: any[] = Array.isArray(body) ? body : [];
            for (const rl of remoteLinks) {
              const linkUrl = rl.object?.url ?? '';
              const linkTitle = rl.object?.title ?? '';
              links.push({
                type: isConfluenceUrl(linkUrl) ? 'confluence' : 'external',
                url: linkUrl,
                title: linkTitle,
              });
            }
          }
          // If response is not ok, silently skip remote links
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } catch {
      // Remote links API call failed; degrade gracefully
    }
  } catch {
    // Total failure in link extraction; return whatever we have so far
  }

  return links;
}

// ─── Operations ───────────────────────────────────────────────────────────────

async function getTicket(key: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    exitWithError('Missing or invalid "key" field', 'INVALID_INPUT');
  }

  const scriptPath = path.join(AT_PATH, 'skills/jira-reader/scripts/jira-get.ts');

  // Extract the project prefix from the key (e.g. "PROJ-123" -> "PROJ")
  const projectMatch = key.match(/^([A-Z][A-Z0-9]+)-\d+$/);
  if (!projectMatch) {
    exitWithError(`Invalid ticket key format: ${key}`, 'INVALID_INPUT');
  }
  const project = projectMatch[1];

  const result = await spawnScript(scriptPath, [
    key,
    '--json',
    '--project', project,
    '--no-comments',
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (stderr.includes('404') || stderr.toLowerCase().includes('not found')) {
      exitWithError(`Ticket ${key} not found`, 'NOT_FOUND');
    }
    if (stderr.toLowerCase().includes('auth') || stderr.toLowerCase().includes('401') || stderr.toLowerCase().includes('403')) {
      exitWithError(`Authentication failed: ${stderr}`, 'AUTH_FAILED');
    }
    exitWithError(`Failed to get ticket ${key}: ${stderr}`, 'UNKNOWN');
  }

  // Parse the raw JSON output from atlassian-tools
  // formatTicketJSON returns JSON.stringify(ticket) where ticket = { key, fields: { ... } }
  let rawTicket: any;
  try {
    rawTicket = JSON.parse(result.stdout);
  } catch {
    exitWithError(`Failed to parse jira-get output as JSON`, 'UNKNOWN');
  }

  const fields = rawTicket.fields || {};

  // The jira-get.ts --json output does not include comments (comments are only
  // included in markdown mode via a separate API call). We return an empty
  // array here. A future enhancement could call the Jira REST API directly
  // to fetch comments when needed.
  const comments: Array<{ author: string; body: string; created: string }> = [];

  // Extract links from issue links, attachments, and remote links.
  // This never throws; on failure it returns [].
  const links = await extractLinks(key, fields);

  // Reshape to our contract
  const output = {
    key: rawTicket.key,
    summary: fields.summary ?? '',
    description: adfToText(fields.description),
    status: fields.status?.name ?? 'Unknown',
    type: fields.issuetype?.name ?? 'Unknown',
    parent: fields.parent?.key ?? null,
    assignee: fields.assignee?.displayName ?? null,
    labels: fields.labels ?? [],
    comments,
    links,
  };

  console.log(JSON.stringify(output));
}

async function searchTickets(jql: string, maxResults: number): Promise<void> {
  if (!jql || typeof jql !== 'string') {
    exitWithError('Missing or invalid "jql" field', 'INVALID_INPUT');
  }

  const scriptPath = path.join(AT_PATH, 'skills/jira-reader/scripts/jira-search.ts');

  const result = await spawnScript(scriptPath, [
    jql,
    '--json',
    '--max-results', String(maxResults),
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (stderr.toLowerCase().includes('auth') || stderr.toLowerCase().includes('401') || stderr.toLowerCase().includes('403')) {
      exitWithError(`Authentication failed: ${stderr}`, 'AUTH_FAILED');
    }
    exitWithError(`Failed to search tickets: ${stderr}`, 'UNKNOWN');
  }

  // atlassian-tools search --json returns formatSearchResultsJSON(issues) which is
  // JSON.stringify(tickets) where tickets is an array of { key, fields: { ... } }
  let rawTickets: any[];
  try {
    rawTickets = JSON.parse(result.stdout);
  } catch {
    exitWithError(`Failed to parse jira-search output as JSON`, 'UNKNOWN');
  }

  // Reshape to our contract
  const tickets = rawTickets.map((t: any) => ({
    key: t.key,
    summary: t.fields?.summary ?? '',
    status: t.fields?.status?.name ?? 'Unknown',
    type: t.fields?.issuetype?.name ?? 'Unknown',
  }));

  console.log(JSON.stringify({ tickets }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    exitWithError('Failed to read stdin', 'INVALID_INPUT');
  }

  if (!raw.trim()) {
    exitWithError('Empty stdin: expected JSON input', 'INVALID_INPUT');
  }

  let input: any;
  try {
    input = JSON.parse(raw);
  } catch {
    exitWithError('Invalid JSON on stdin', 'INVALID_INPUT');
  }

  if (!input.operation || typeof input.operation !== 'string') {
    exitWithError('Missing or invalid "operation" field in input', 'INVALID_INPUT');
  }

  switch (input.operation) {
    case 'get-ticket':
      await getTicket(input.key);
      break;

    case 'search-tickets':
      await searchTickets(input.jql, input.max_results ?? 50);
      break;

    default:
      exitWithError(`Unknown operation: ${input.operation}`, 'INVALID_INPUT');
  }
}

main().catch((err) => {
  exitWithError(`Unhandled error: ${err.message}`, 'UNKNOWN');
});
