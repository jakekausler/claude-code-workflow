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
