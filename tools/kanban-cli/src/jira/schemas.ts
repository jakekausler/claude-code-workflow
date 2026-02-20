import { z } from 'zod';

// ─── Stdin schemas ──────────────────────────────────────────────────────────

export const getTicketInputSchema = z.object({
  operation: z.literal('get-ticket'),
  key: z.string(),
});

export const searchTicketsInputSchema = z.object({
  operation: z.literal('search-tickets'),
  jql: z.string(),
  max_results: z.number().optional().default(50),
});

export const transitionTicketInputSchema = z.object({
  operation: z.literal('transition-ticket'),
  key: z.string(),
  target_status: z.string(),
});

export const assignTicketInputSchema = z.object({
  operation: z.literal('assign-ticket'),
  key: z.string(),
  assignee: z.string().nullable(),
});

export const addCommentInputSchema = z.object({
  operation: z.literal('add-comment'),
  key: z.string(),
  body: z.string(),
});

// ─── Stdout schemas ─────────────────────────────────────────────────────────

export const jiraTicketDataSchema = z.object({
  key: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  parent: z.string().nullable(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  comments: z.array(z.object({
    author: z.string(),
    body: z.string(),
    created: z.string(),
  })),
});

export const jiraSearchResultSchema = z.object({
  tickets: z.array(z.object({
    key: z.string(),
    summary: z.string(),
    status: z.string(),
    type: z.string(),
  })),
});

export const jiraTransitionResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
  previous_status: z.string(),
  new_status: z.string(),
});

export const jiraAssignResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
});

export const jiraCommentResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
  comment_id: z.string(),
});
