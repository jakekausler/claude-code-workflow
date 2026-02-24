import { z } from 'zod';

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

export const pendingMergeParentSchema = z.object({
  stage_id: z.string(),
  branch: z.string(),
  pr_url: z.string(),
  pr_number: z.number(),
});

export const jiraLinkSchema = z.object({
  type: z.enum(['confluence', 'jira_issue', 'attachment', 'external']),
  url: z.string(),
  title: z.string(),
  key: z.string().optional(),
  relationship: z.string().optional(),
  filename: z.string().optional(),
  mime_type: z.string().optional(),
});

// ─── Full-document schemas ──────────────────────────────────────────────────
// Available for standalone validation and future use.
// Sub-schemas (pendingMergeParentSchema, jiraLinkSchema) are used directly by the parser.

// ─── Stage frontmatter schema ───────────────────────────────────────────────

export const stageFrontmatterSchema = z.object({
  id: z.string(),
  ticket: z.string(),
  epic: z.string(),
  title: z.string(),
  status: z.string(),
  session_active: z.boolean().default(false),
  refinement_type: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  worktree_branch: z.string().nullable().default(null),
  pr_url: z.string().nullable().default(null),
  pr_number: z.number().nullable().default(null),
  priority: z.number().default(0),
  due_date: z.string().nullable().default(null),
  pending_merge_parents: z.array(pendingMergeParentSchema).default([]),
  is_draft: z.boolean().default(false),
  mr_target_branch: z.string().nullable().default(null),
});

// ─── Ticket frontmatter schema ──────────────────────────────────────────────

export const ticketFrontmatterSchema = z.object({
  id: z.string(),
  epic: z.string(),
  title: z.string(),
  status: z.string(),
  jira_key: z.string().nullable().default(null),
  source: z.enum(['local', 'jira']).default('local'),
  stages: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  jira_links: z.array(jiraLinkSchema).default([]),
  stage_statuses: z.record(z.string(), z.string()).default({}),
});

// ─── Epic frontmatter schema ────────────────────────────────────────────────

export const epicFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  jira_key: z.string().nullable().default(null),
  tickets: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  ticket_statuses: z.record(z.string(), z.string()).default({}),
});
