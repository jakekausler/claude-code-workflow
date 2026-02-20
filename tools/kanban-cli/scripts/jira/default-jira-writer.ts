#!/usr/bin/env tsx

/**
 * Default Jira writer wrapper script.
 *
 * Reads JSON from stdin, validates the operation field, and either delegates
 * to atlassian-tools CLI scripts or implements directly via the Jira REST API.
 *
 * Supported operations:
 *   - assign-ticket:     assign a ticket to a user
 *   - add-comment:       add a comment to a ticket
 *   - transition-ticket: transition a ticket to a new status (direct API)
 *
 * Error output: JSON on stderr with { error, code } fields.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// ─── Auth helper for direct API calls ─────────────────────────────────────────

interface JiraCredentials {
  email: string;
  token: string;
  baseUrl: string;
}

/**
 * Load Jira credentials by dynamically importing the atlassian-tools auth helper.
 * Falls back to environment variables if the import fails.
 */
async function getCredentials(): Promise<JiraCredentials> {
  // Try importing atlassian-tools auth helper
  try {
    const authModule = await import(`${AT_PATH}/lib/auth-helper.js`);
    return authModule.getCredentials();
  } catch {
    // Fallback: try environment variables directly
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_TOKEN;
    const baseUrl = process.env.JIRA_BASE_URL;

    if (email && token && baseUrl) {
      return { email, token, baseUrl };
    }

    exitWithError(
      'Failed to load Jira credentials. Set JIRA_EMAIL, JIRA_TOKEN, and JIRA_BASE_URL environment variables.',
      'AUTH_FAILED',
    );
  }
}

function encodeAuth(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraFetch(
  creds: JiraCredentials,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const url = `${creds.baseUrl}${apiPath}`;
  const headers: Record<string, string> = {
    'Authorization': `Basic ${encodeAuth(creds.email, creds.token)}`,
    'Accept': 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const status = response.status;

  if (status === 204) {
    return { status, data: undefined };
  }

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status, data };
}

// ─── Operations ───────────────────────────────────────────────────────────────

async function assignTicket(key: string, assignee: string | null): Promise<void> {
  if (!key || typeof key !== 'string') {
    exitWithError('Missing or invalid "key" field', 'INVALID_INPUT');
  }

  const scriptPath = path.join(AT_PATH, 'skills/jira-writer/scripts/jira-write.ts');

  // atlassian-tools jira-write.ts uses --assignee with an account ID or "me"
  // null or undefined means "assign to authenticated API user"
  const assigneeArg = assignee == null ? 'me' : assignee;

  const result = await spawnScript(scriptPath, [
    '--key', key,
    '--assignee', assigneeArg,
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (stderr.includes('404') || stderr.toLowerCase().includes('not found')) {
      exitWithError(`Ticket ${key} not found`, 'NOT_FOUND');
    }
    if (stderr.toLowerCase().includes('auth') || stderr.toLowerCase().includes('401') || stderr.toLowerCase().includes('403')) {
      exitWithError(`Authentication failed: ${stderr}`, 'AUTH_FAILED');
    }
    exitWithError(`Failed to assign ticket ${key}: ${stderr}`, 'UNKNOWN');
  }

  console.log(JSON.stringify({ key, success: true }));
}

async function addComment(key: string, body: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    exitWithError('Missing or invalid "key" field', 'INVALID_INPUT');
  }
  if (!body || typeof body !== 'string') {
    exitWithError('Missing or invalid "body" field', 'INVALID_INPUT');
  }

  const scriptPath = path.join(AT_PATH, 'skills/jira-writer/scripts/jira-write.ts');

  // Write the comment body to a temp file
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'kanban-comment-'));
  const tmpFile = path.join(tmpDir, 'comment.md');
  writeFileSync(tmpFile, body, 'utf-8');

  try {
    const result = await spawnScript(scriptPath, [
      '--key', key,
      '--comment-file', tmpFile,
    ]);

    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      if (stderr.includes('404') || stderr.toLowerCase().includes('not found')) {
        exitWithError(`Ticket ${key} not found`, 'NOT_FOUND');
      }
      if (stderr.toLowerCase().includes('auth') || stderr.toLowerCase().includes('401') || stderr.toLowerCase().includes('403')) {
        exitWithError(`Authentication failed: ${stderr}`, 'AUTH_FAILED');
      }
      exitWithError(`Failed to add comment to ${key}: ${stderr}`, 'UNKNOWN');
    }

    // The atlassian-tools jira-write.ts outputs { key, url, fields_set, comment_added }
    // but doesn't include the comment ID. We'll parse what we can.
    let commentId = 'unknown';
    try {
      const output = JSON.parse(result.stdout);
      // atlassian-tools doesn't return comment_id from jira-write.ts,
      // so we report "unknown". The addIssueComment REST call returns { id },
      // but jira-write.ts doesn't surface it.
      commentId = output.comment_id ?? 'unknown';
    } catch {
      // If output isn't parseable, still report success since exit code was 0
    }

    console.log(JSON.stringify({ key, success: true, comment_id: commentId }));
  } finally {
    // Clean up temp file and directory
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore: file may not exist if script failed before writing
    }
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // Ignore: directory may not exist
    }
  }
}

async function transitionTicket(key: string, targetStatus: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    exitWithError('Missing or invalid "key" field', 'INVALID_INPUT');
  }
  if (!targetStatus || typeof targetStatus !== 'string') {
    exitWithError('Missing or invalid "target_status" field', 'INVALID_INPUT');
  }

  // Transition is NOT supported by atlassian-tools jira-write.ts.
  // Implement directly using Jira REST API.

  let creds: JiraCredentials;
  try {
    creds = await getCredentials();
  } catch (err: any) {
    exitWithError(`Failed to get credentials: ${err.message}`, 'AUTH_FAILED');
  }

  const encodedKey = encodeURIComponent(key);

  // 1. Get current status
  const issueResult = await jiraFetch(creds, 'GET', `/rest/api/3/issue/${encodedKey}?fields=status`);
  if (issueResult.status === 404) {
    exitWithError(`Ticket ${key} not found`, 'NOT_FOUND');
  }
  if (issueResult.status === 401 || issueResult.status === 403) {
    exitWithError(`Authentication failed for ticket ${key}`, 'AUTH_FAILED');
  }
  if (issueResult.status < 200 || issueResult.status >= 300) {
    exitWithError(`Failed to get ticket ${key}: HTTP ${issueResult.status}`, 'UNKNOWN');
  }

  const previousStatus = issueResult.data?.fields?.status?.name ?? 'Unknown';

  // 2. Get available transitions
  const transitionsResult = await jiraFetch(creds, 'GET', `/rest/api/3/issue/${encodedKey}/transitions`);
  if (transitionsResult.status < 200 || transitionsResult.status >= 300) {
    exitWithError(
      `Failed to get transitions for ${key}: HTTP ${transitionsResult.status}`,
      'UNKNOWN',
    );
  }

  const transitions: Array<{ id: string; name: string }> = transitionsResult.data?.transitions ?? [];

  // 3. Find matching transition (case-insensitive)
  const targetLower = targetStatus.toLowerCase();
  const matching = transitions.find(
    (t) => t.name.toLowerCase() === targetLower,
  );

  if (!matching) {
    const available = transitions.map((t) => t.name).join(', ');
    exitWithError(
      `No transition to '${targetStatus}' available from '${previousStatus}'. Available: ${available || 'none'}`,
      'TRANSITION_NOT_AVAILABLE',
    );
  }

  // 4. Execute transition
  const doTransition = await jiraFetch(
    creds,
    'POST',
    `/rest/api/3/issue/${encodedKey}/transitions`,
    { transition: { id: matching.id } },
  );

  if (doTransition.status < 200 || doTransition.status >= 300) {
    exitWithError(
      `Failed to transition ${key} to '${targetStatus}': HTTP ${doTransition.status}`,
      'UNKNOWN',
    );
  }

  console.log(JSON.stringify({
    key,
    success: true,
    previous_status: previousStatus,
    new_status: targetStatus,
  }));
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
    case 'assign-ticket':
      await assignTicket(input.key, input.assignee);
      break;

    case 'add-comment':
      await addComment(input.key, input.body);
      break;

    case 'transition-ticket':
      await transitionTicket(input.key, input.target_status);
      break;

    default:
      exitWithError(`Unknown operation: ${input.operation}`, 'INVALID_INPUT');
  }
}

main().catch((err) => {
  exitWithError(`Unhandled error: ${err.message}`, 'UNKNOWN');
});
