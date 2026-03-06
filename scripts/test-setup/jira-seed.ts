#!/usr/bin/env npx tsx

/**
 * jira-seed.ts — Create test Jira tickets for integration testing.
 *
 * Creates:
 *   - 1 Epic with the label "kanban-test"
 *   - 3 child tickets in various statuses (To Do, In Progress, Done)
 *   - 1 comment on the first child ticket
 *   - 1 remote Confluence link on the epic (if JIRA_CONFLUENCE_URL is set)
 *
 * Outputs created issue keys to stdout and writes them to .jira-seed-state.json
 * in the current working directory for use by jira-teardown.ts.
 *
 * Required env vars:
 *   JIRA_BASE_URL  — e.g. https://yourorg.atlassian.net
 *   JIRA_EMAIL     — Atlassian account email
 *   JIRA_TOKEN     — Atlassian API token
 *   JIRA_PROJECT   — Jira project key, e.g. TEST
 *
 * Optional env vars:
 *   JIRA_CONFLUENCE_URL — A Confluence page URL to attach as a remote link to the epic
 *
 * Usage:
 *   npx ts-node scripts/test-setup/jira-seed.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Credentials ─────────────────────────────────────────────────────────────

interface JiraCredentials {
  baseUrl: string;
  email: string;
  token: string;
  project: string;
}

function getCredentials(): JiraCredentials {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_TOKEN;
  const project = process.env.JIRA_PROJECT;

  const missing: string[] = [];
  if (!baseUrl) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!token) missing.push('JIRA_TOKEN');
  if (!project) missing.push('JIRA_PROJECT');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  return { baseUrl: baseUrl!, email: email!, token: token!, project: project! };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

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
    Authorization: `Basic ${encodeAuth(creds.email, creds.token)}`,
    Accept: 'application/json',
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

// ─── Jira API helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the issue type ID for "Epic" in the given project.
 * Falls back to using the name string directly if the metadata endpoint fails.
 */
async function resolveEpicIssueTypeId(creds: JiraCredentials): Promise<string> {
  const result = await jiraFetch(
    creds,
    'GET',
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(creds.project)}&expand=projects.issuetypes`,
  );

  if (result.status === 200) {
    const projects: any[] = result.data?.projects ?? [];
    for (const proj of projects) {
      const types: any[] = proj.issuetypes ?? [];
      const epic = types.find((t: any) => t.name === 'Epic');
      if (epic) {
        return epic.id as string;
      }
    }
  }

  // Fall back: return the name; Jira accepts name in issuetype.name field
  return 'Epic';
}

/**
 * Create a Jira issue. Returns the created issue key.
 */
async function createIssue(
  creds: JiraCredentials,
  fields: Record<string, unknown>,
): Promise<string> {
  const result = await jiraFetch(creds, 'POST', '/rest/api/3/issue', { fields });

  if (result.status < 200 || result.status >= 300) {
    const detail = typeof result.data === 'object'
      ? JSON.stringify(result.data)
      : String(result.data);
    throw new Error(`Failed to create issue (HTTP ${result.status}): ${detail}`);
  }

  return result.data.key as string;
}

/**
 * Transition a ticket to a target status by name (case-insensitive).
 */
async function transitionIssue(
  creds: JiraCredentials,
  key: string,
  targetStatus: string,
): Promise<void> {
  const transitionsResult = await jiraFetch(
    creds,
    'GET',
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
  );

  if (transitionsResult.status < 200 || transitionsResult.status >= 300) {
    throw new Error(`Failed to get transitions for ${key}: HTTP ${transitionsResult.status}`);
  }

  const transitions: Array<{ id: string; name: string }> =
    transitionsResult.data?.transitions ?? [];
  const targetLower = targetStatus.toLowerCase();
  const match = transitions.find((t) => t.name.toLowerCase() === targetLower);

  if (!match) {
    const available = transitions.map((t) => t.name).join(', ');
    // Non-fatal: log warning and continue — test environments vary in available transitions
    console.warn(
      `  [warn] No transition to "${targetStatus}" available for ${key}. Available: ${available || 'none'}`,
    );
    return;
  }

  const doTransition = await jiraFetch(
    creds,
    'POST',
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    { transition: { id: match.id } },
  );

  if (doTransition.status < 200 || doTransition.status >= 300) {
    throw new Error(
      `Failed to transition ${key} to "${targetStatus}": HTTP ${doTransition.status}`,
    );
  }
}

/**
 * Add a plain-text comment to a Jira issue using ADF format.
 */
async function addComment(
  creds: JiraCredentials,
  key: string,
  commentText: string,
): Promise<string> {
  const body = {
    body: {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: commentText }],
        },
      ],
    },
  };

  const result = await jiraFetch(
    creds,
    'POST',
    `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    body,
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Failed to add comment to ${key}: HTTP ${result.status}`);
  }

  return result.data.id as string;
}

/**
 * Add a remote (Confluence) link to a Jira issue.
 */
async function addRemoteLink(
  creds: JiraCredentials,
  key: string,
  url: string,
  title: string,
): Promise<void> {
  const body = {
    object: { url, title, icon: { url16x16: '', title } },
  };

  const result = await jiraFetch(
    creds,
    'POST',
    `/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`,
    body,
  );

  if (result.status < 200 || result.status >= 300) {
    console.warn(`  [warn] Failed to add remote link to ${key}: HTTP ${result.status}`);
  }
}

// ─── State file ───────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), '.jira-seed-state.json');

interface SeedState {
  createdAt: string;
  epicKey: string;
  ticketKeys: string[];
  allKeys: string[];
}

function writeStateFile(state: SeedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const creds = getCredentials();
  const ts = Date.now();
  const label = 'kanban-test';

  console.log(`Seeding Jira test data in project ${creds.project}...`);

  // 1. Resolve Epic issue type
  console.log('  Resolving Epic issue type...');
  const epicTypeId = await resolveEpicIssueTypeId(creds);

  // 2. Create Epic
  console.log('  Creating Epic...');
  const epicKey = await createIssue(creds, {
    project: { key: creds.project },
    summary: `[kanban-test] Test Epic ${ts}`,
    description: {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Integration test epic created by jira-seed.ts' },
          ],
        },
      ],
    },
    issuetype: epicTypeId.length < 10 ? { id: epicTypeId } : { name: 'Epic' },
    labels: [label],
  });
  console.log(`    Created epic: ${epicKey}`);

  // 3. Create 3 child tickets
  const ticketSpecs = [
    { summary: `[kanban-test] Todo ticket ${ts}`, targetStatus: null },
    { summary: `[kanban-test] In Progress ticket ${ts}`, targetStatus: 'In Progress' },
    { summary: `[kanban-test] Done ticket ${ts}`, targetStatus: 'Done' },
  ];

  const ticketKeys: string[] = [];

  for (const spec of ticketSpecs) {
    console.log(`  Creating ticket: ${spec.summary}...`);
    const key = await createIssue(creds, {
      project: { key: creds.project },
      summary: spec.summary,
      issuetype: { name: 'Story' },
      labels: [label],
      parent: { key: epicKey },
    });
    console.log(`    Created ticket: ${key}`);
    ticketKeys.push(key);

    if (spec.targetStatus) {
      console.log(`    Transitioning ${key} to "${spec.targetStatus}"...`);
      await transitionIssue(creds, key, spec.targetStatus);
    }
  }

  // 4. Add comment to first ticket
  const firstTicket = ticketKeys[0];
  if (firstTicket) {
    console.log(`  Adding comment to ${firstTicket}...`);
    await addComment(
      creds,
      firstTicket,
      'Integration test comment added by jira-seed.ts. Safe to delete.',
    );
  }

  // 5. Add Confluence remote link to epic (optional)
  const confluenceUrl = process.env.JIRA_CONFLUENCE_URL;
  if (confluenceUrl) {
    console.log(`  Adding Confluence remote link to ${epicKey}...`);
    await addRemoteLink(creds, epicKey, confluenceUrl, 'Test Confluence Page');
  }

  // 6. Write state file and print summary
  const allKeys = [epicKey, ...ticketKeys];
  const state: SeedState = {
    createdAt: new Date().toISOString(),
    epicKey,
    ticketKeys,
    allKeys,
  };
  writeStateFile(state);

  console.log('\nSeed complete.');
  console.log(`Epic:    ${epicKey}`);
  console.log(`Tickets: ${ticketKeys.join(', ')}`);
  console.log(`State written to: ${STATE_FILE}`);
  console.log('\nCreated issue keys (for teardown):');
  for (const key of allKeys) {
    console.log(`  ${key}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
