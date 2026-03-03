#!/usr/bin/env npx tsx

/**
 * jira-teardown.ts — Delete test Jira tickets created by jira-seed.ts.
 *
 * Accepts issue keys two ways (checked in order):
 *   1. CLI arguments:   npx ts-node scripts/test-setup/jira-teardown.ts PROJ-1 PROJ-2
 *   2. State file:      reads .jira-seed-state.json in the current working directory
 *
 * Required env vars:
 *   JIRA_BASE_URL  — e.g. https://yourorg.atlassian.net
 *   JIRA_EMAIL     — Atlassian account email
 *   JIRA_TOKEN     — Atlassian API token
 *
 * Usage:
 *   npx ts-node scripts/test-setup/jira-teardown.ts
 *   npx ts-node scripts/test-setup/jira-teardown.ts PROJ-123 PROJ-124 PROJ-125
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Credentials ─────────────────────────────────────────────────────────────

interface JiraCredentials {
  baseUrl: string;
  email: string;
  token: string;
}

function getCredentials(): JiraCredentials {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_TOKEN;

  const missing: string[] = [];
  if (!baseUrl) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!token) missing.push('JIRA_TOKEN');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  return { baseUrl: baseUrl!, email: email!, token: token! };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function encodeAuth(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraFetch(
  creds: JiraCredentials,
  method: string,
  apiPath: string,
): Promise<{ status: number; data: any }> {
  const url = `${creds.baseUrl}${apiPath}`;
  const headers: Record<string, string> = {
    Authorization: `Basic ${encodeAuth(creds.email, creds.token)}`,
    Accept: 'application/json',
  };

  const response = await fetch(url, { method, headers });
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

// ─── State file ───────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), '.jira-seed-state.json');

interface SeedState {
  createdAt: string;
  epicKey: string;
  ticketKeys: string[];
  allKeys: string[];
}

function readStateFile(): SeedState | null {
  if (!fs.existsSync(STATE_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as SeedState;
  } catch {
    console.error(`Failed to parse state file at ${STATE_FILE}`);
    return null;
  }
}

function deleteStateFile(): void {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    console.log(`Deleted state file: ${STATE_FILE}`);
  }
}

// ─── Delete helper ────────────────────────────────────────────────────────────

/**
 * Delete a single Jira issue. Logs the result without throwing —
 * a 404 means it was already gone, which is acceptable for teardown.
 */
async function deleteIssue(creds: JiraCredentials, key: string): Promise<void> {
  const result = await jiraFetch(
    creds,
    'DELETE',
    `/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=true`,
  );

  if (result.status === 204 || result.status === 200) {
    console.log(`  Deleted: ${key}`);
  } else if (result.status === 404) {
    console.log(`  Already gone (404): ${key}`);
  } else if (result.status === 403) {
    console.error(`  Permission denied deleting ${key} (HTTP 403). Check your API token permissions.`);
  } else {
    const detail = typeof result.data === 'object'
      ? JSON.stringify(result.data)
      : String(result.data);
    console.error(`  Failed to delete ${key} (HTTP ${result.status}): ${detail}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const creds = getCredentials();

  // Resolve keys: CLI args take precedence over state file
  const cliKeys = process.argv.slice(2).filter((a) => /^[A-Z][A-Z0-9]+-\d+$/.test(a));
  let keys: string[];

  if (cliKeys.length > 0) {
    keys = cliKeys;
    console.log(`Using ${keys.length} key(s) from CLI arguments.`);
  } else {
    const state = readStateFile();
    if (!state) {
      console.error(
        `No issue keys provided and no state file found at ${STATE_FILE}.\n` +
        `Usage: npx ts-node scripts/test-setup/jira-teardown.ts [KEY1 KEY2 ...]`,
      );
      process.exit(1);
    }
    keys = state.allKeys;
    console.log(`Using ${keys.length} key(s) from state file (seeded at ${state.createdAt}).`);
  }

  if (keys.length === 0) {
    console.log('No keys to delete. Nothing to do.');
    return;
  }

  console.log(`\nDeleting ${keys.length} issue(s)...`);

  // Delete child tickets first, then the epic to avoid dependency errors
  const epicPattern = /^[A-Z][A-Z0-9]+-\d+$/;
  // Heuristic: delete in reverse order (tickets were created after the epic)
  const ordered = [...keys].reverse();

  for (const key of ordered) {
    if (!epicPattern.test(key)) {
      console.warn(`  Skipping invalid key format: ${key}`);
      continue;
    }
    await deleteIssue(creds, key);
  }

  // Clean up state file if it exists and we used it
  if (cliKeys.length === 0) {
    deleteStateFile();
  }

  console.log('\nTeardown complete.');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
