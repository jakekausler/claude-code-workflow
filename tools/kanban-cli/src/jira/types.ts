import { z } from 'zod';
import {
  getTicketInputSchema,
  searchTicketsInputSchema,
  transitionTicketInputSchema,
  assignTicketInputSchema,
  addCommentInputSchema,
  jiraTicketDataSchema,
  jiraSearchResultSchema,
  jiraTransitionResultSchema,
  jiraAssignResultSchema,
  jiraCommentResultSchema,
} from './schemas.js';

// ─── Input types (inferred from stdin schemas) ─────────────────────────────

export type GetTicketInput = z.infer<typeof getTicketInputSchema>;
export type SearchTicketsInput = z.infer<typeof searchTicketsInputSchema>;
export type TransitionTicketInput = z.infer<typeof transitionTicketInputSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketInputSchema>;
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;

// ─── Output types (inferred from stdout schemas) ───────────────────────────

export type JiraTicketData = z.infer<typeof jiraTicketDataSchema>;
export type JiraSearchResult = z.infer<typeof jiraSearchResultSchema>;
export type JiraTransitionResult = z.infer<typeof jiraTransitionResultSchema>;
export type JiraAssignResult = z.infer<typeof jiraAssignResultSchema>;
export type JiraCommentResult = z.infer<typeof jiraCommentResultSchema>;

// ─── Executor interface ────────────────────────────────────────────────────

export interface JiraExecutor {
  getTicket(key: string): Promise<JiraTicketData>;
  searchTickets(jql: string, maxResults?: number): Promise<JiraSearchResult>;
  transitionTicket(key: string, targetStatus: string): Promise<JiraTransitionResult>;
  assignTicket(key: string, assignee: string | null): Promise<JiraAssignResult>;
  addComment(key: string, body: string): Promise<JiraCommentResult>;
  canRead(): boolean;
  canWrite(): boolean;
}
