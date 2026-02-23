import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { parseTicketFrontmatter } from '../../parser/frontmatter.js';
import type { JiraExecutor, JiraTicketData } from '../../jira/types.js';
import type { JiraLink } from '../../types/work-items.js';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface EnrichOptions {
  repoPath: string;
  ticketPath: string;
  executor?: JiraExecutor;
  confluenceScriptPath?: string;
}

export interface EnrichResult {
  ticketId: string;
  enrichmentFilePath: string | null;
  freshJiraData: boolean;
  linkResults: Array<{
    link: JiraLink;
    success: boolean;
    error?: string;
  }>;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Resolve the confluence-get.ts script path.
 * 1. Check explicit override
 * 2. Glob for atlassian-tools plugin
 * 3. Check CONFLUENCE_GET_SCRIPT env var
 * Returns null if not found.
 */
function resolveConfluenceScript(override?: string): string | null {
  if (override) {
    return override;
  }

  // Try to find the atlassian-tools plugin
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const pluginGlob = path.join(
    homeDir,
    '.claude',
    'plugins',
    'cache',
    'claude-code-marketplace',
    'atlassian-tools',
    '*',
    'skills',
    'confluence-reader',
    'scripts',
    'confluence-get.ts',
  );

  try {
    // fs.globSync is available in Node 22+
    const matches = (fs as any).globSync(pluginGlob);
    if (Array.isArray(matches) && matches.length > 0) {
      // Sort to get latest version
      matches.sort();
      return matches[matches.length - 1];
    }
  } catch {
    // globSync not available or failed
  }

  // Fall back to environment variable
  const envScript = process.env.CONFLUENCE_GET_SCRIPT;
  if (envScript) {
    return envScript;
  }

  return null;
}

/**
 * Spawn `npx tsx <script> <url> --no-metadata` and capture stdout.
 */
function fetchConfluenceContent(scriptPath: string, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath, url, '--no-metadata'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn confluence script: ${err.message}`));
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`Confluence script exited with code ${exitCode}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Fetch content via HTTP GET. Returns response body as text.
 */
async function httpGet(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Compute the enrichment output file path from the ticket path.
 * e.g. /repo/epics/EPIC-001/TICKET-001-001.md → /repo/epics/EPIC-001/TICKET-001-001-enrichment.md
 */
function enrichmentFilePath(ticketPath: string): string {
  const dir = path.dirname(ticketPath);
  const base = path.basename(ticketPath, '.md');
  return path.join(dir, `${base}-enrichment.md`);
}

// ─── Content formatters ─────────────────────────────────────────────────────

function formatFreshJiraData(data: JiraTicketData): string {
  const lines: string[] = [];
  lines.push(`## Fresh Jira Data (${data.key})`);
  lines.push('');
  lines.push(`**Status**: ${data.status}`);
  if (data.assignee) {
    lines.push(`**Assignee**: ${data.assignee}`);
  }
  if (data.labels.length > 0) {
    lines.push(`**Labels**: ${data.labels.join(', ')}`);
  }

  if (data.description) {
    lines.push('');
    lines.push('### Description');
    lines.push('');
    lines.push(data.description);
  }

  if (data.comments.length > 0) {
    lines.push('');
    lines.push('### Comments');
    lines.push('');
    for (const comment of data.comments) {
      lines.push(`**${comment.author}** (${comment.created}): ${comment.body}`);
    }
  }

  return lines.join('\n');
}

function formatConfluenceLink(link: JiraLink, content: string): string {
  const lines: string[] = [];
  lines.push(`### [Confluence] ${link.title}`);
  lines.push(`*Source: ${link.url}*`);
  lines.push('');
  lines.push(content);
  return lines.join('\n');
}

function formatJiraIssueLink(link: JiraLink, data: JiraTicketData): string {
  const lines: string[] = [];
  lines.push(`### [Jira Issue] ${data.key}: ${data.summary}`);
  lines.push(`*Source: ${link.url}*`);
  if (link.relationship) {
    lines.push(`*Relationship: ${link.relationship}*`);
  }
  lines.push('');
  lines.push(`**Status**: ${data.status}`);
  if (data.description) {
    lines.push(`**Description**: ${data.description}`);
  }
  return lines.join('\n');
}

function formatAttachmentLink(link: JiraLink, content: string | null, isTextBased: boolean): string {
  const lines: string[] = [];
  lines.push(`### [Attachment] ${link.filename ?? link.title}`);
  lines.push(`*Source: ${link.url}*`);
  lines.push('');
  if (!isTextBased) {
    lines.push(`> Attachment type ${link.mime_type ?? 'unknown'} cannot be extracted as text. Download manually from link above.`);
  } else if (content) {
    lines.push(content);
  }
  return lines.join('\n');
}

function formatExternalLink(link: JiraLink, content: string): string {
  const lines: string[] = [];
  lines.push(`### [External] ${link.title}`);
  lines.push(`*Source: ${link.url}*`);
  lines.push('');
  lines.push(content);
  return lines.join('\n');
}

function formatLinkError(link: JiraLink, error: string): string {
  const typeLabel = linkTypeLabel(link.type);
  const lines: string[] = [];
  lines.push(`### [${typeLabel}] ${link.title}`);
  lines.push(`*Source: ${link.url}*`);
  lines.push('');
  lines.push(`> Could not fetch: ${error}`);
  return lines.join('\n');
}

function linkTypeLabel(type: JiraLink['type']): string {
  switch (type) {
    case 'confluence': return 'Confluence';
    case 'jira_issue': return 'Jira Issue';
    case 'attachment': return 'Attachment';
    case 'external': return 'External';
  }
}

/**
 * Determine if a MIME type represents text-extractable content.
 */
function isTextMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  );
}

// ─── Main enrichment function ───────────────────────────────────────────────

/**
 * Enrich a ticket by fetching linked content and writing an enrichment file.
 *
 * - Reads the ticket markdown, parses frontmatter for jira_links and jira_key
 * - If nothing to enrich, returns early with enrichmentFilePath: null
 * - Re-pulls fresh Jira data if jira_key is present
 * - Fetches each link sequentially (confluence, jira_issue, attachment, external)
 * - Writes compiled content to <ticket>-enrichment.md
 * - Never throws for fetch failures; only throws for file I/O errors
 */
export async function enrichTicket(options: EnrichOptions): Promise<EnrichResult> {
  const { repoPath, ticketPath, executor, confluenceScriptPath } = options;

  // 1. Read and parse ticket
  const ticketContent = fs.readFileSync(ticketPath, 'utf-8');
  const ticket = parseTicketFrontmatter(ticketContent, ticketPath);

  // 2. Early return if nothing to enrich
  if (ticket.jira_links.length === 0 && !ticket.jira_key) {
    return {
      ticketId: ticket.id,
      enrichmentFilePath: null,
      freshJiraData: false,
      linkResults: [],
    };
  }

  const sections: string[] = [];
  let freshJiraData = false;

  // Header
  sections.push(`# Enrichment Context for ${ticket.id}`);
  sections.push('');
  sections.push('> Auto-generated by \`kanban-cli enrich\`. Do not edit manually.');
  sections.push(`> Generated: ${new Date().toISOString()}`);

  // 3. Re-pull fresh Jira data if jira_key exists
  if (ticket.jira_key && executor) {
    try {
      const jiraData = await executor.getTicket(ticket.jira_key);
      freshJiraData = true;
      sections.push('');
      sections.push(formatFreshJiraData(jiraData));
    } catch {
      // Jira fetch failure is non-fatal
      sections.push('');
      sections.push(`## Fresh Jira Data (${ticket.jira_key})`);
      sections.push('');
      sections.push('> Could not fetch fresh Jira data.');
    }
  }

  // 4. Fetch each link sequentially
  const linkResults: EnrichResult['linkResults'] = [];

  if (ticket.jira_links.length > 0) {
    sections.push('');
    sections.push('## Linked Content');
  }

  for (const link of ticket.jira_links) {
    try {
      let linkContent: string;

      switch (link.type) {
        case 'confluence': {
          const scriptPath = resolveConfluenceScript(confluenceScriptPath);
          if (!scriptPath) {
            throw new Error('Confluence reader not available');
          }
          const content = await fetchConfluenceContent(scriptPath, link.url);
          linkContent = formatConfluenceLink(link, content.trim());
          break;
        }

        case 'jira_issue': {
          if (!executor) {
            throw new Error('No Jira executor available');
          }
          const issueKey = link.key;
          if (!issueKey) {
            throw new Error('No key available for Jira issue link');
          }
          const issueData = await executor.getTicket(issueKey);
          linkContent = formatJiraIssueLink(link, issueData);
          break;
        }

        case 'attachment': {
          const textBased = isTextMimeType(link.mime_type);
          if (!textBased) {
            linkContent = formatAttachmentLink(link, null, false);
          } else {
            const body = await httpGet(link.url);
            linkContent = formatAttachmentLink(link, body, true);
          }
          break;
        }

        case 'external': {
          const body = await httpGet(link.url);
          linkContent = formatExternalLink(link, body);
          break;
        }
      }

      sections.push('');
      sections.push(linkContent);
      linkResults.push({ link, success: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sections.push('');
      sections.push(formatLinkError(link, errorMessage));
      linkResults.push({ link, success: false, error: errorMessage });
    }
  }

  // 6. Write enrichment file
  const outPath = enrichmentFilePath(ticketPath);
  const content = sections.join('\n') + '\n';
  fs.writeFileSync(outPath, content);

  // 7. Return result
  return {
    ticketId: ticket.id,
    enrichmentFilePath: outPath,
    freshJiraData,
    linkResults,
  };
}
