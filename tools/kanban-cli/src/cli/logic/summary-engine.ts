import { createHash } from 'node:crypto';
import type { ClaudeExecutor } from '../../utils/claude-executor.js';
import type { SummaryRepository } from '../../db/repositories/summary-repository.js';

// ---------- Types ----------

export type SummaryItemType = 'stage' | 'ticket' | 'epic';

export interface SummaryResult {
  id: string;
  type: SummaryItemType;
  title: string;
  summary: string;
  cached: boolean;
}

export interface StageSummaryInput {
  id: string;
  title: string;
  status: string;
  file_content: string;
}

export interface TicketSummaryInput {
  id: string;
  title: string;
  status: string;
  stages: StageSummaryInput[];
}

export interface EpicSummaryInput {
  id: string;
  title: string;
  status: string;
  tickets: TicketSummaryInput[];
}

export interface SummaryEngineOptions {
  executor: ClaudeExecutor;
  summaryRepo: SummaryRepository;
  repoId: number;
  model?: string;
  noCache?: boolean;
}

// ---------- Hash computation ----------

/**
 * Compute SHA-256 hash of content.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------- Prompt builders ----------

function buildStagePrompt(stage: StageSummaryInput): string {
  return `Summarize the following stage file content in 2-3 concise sentences. Focus on what was done, key decisions made, and current status.

Stage: ${stage.title} (${stage.id})
Status: ${stage.status}

File content:
${stage.file_content}`;
}

function buildTicketPrompt(ticket: TicketSummaryInput, stageSummaries: string[]): string {
  const stageText = stageSummaries.join('\n\n');
  return `Summarize the following ticket based on its stage summaries in 2-3 concise sentences. Focus on overall progress, what was accomplished, and what remains.

Ticket: ${ticket.title} (${ticket.id})
Status: ${ticket.status}

Stage summaries:
${stageText}`;
}

function buildEpicPrompt(epic: EpicSummaryInput, ticketSummaries: string[]): string {
  const ticketText = ticketSummaries.join('\n\n');
  return `Summarize the following epic based on its ticket summaries in 2-3 concise sentences. Focus on overall progress, key achievements, and remaining work.

Epic: ${epic.title} (${epic.id})
Status: ${epic.status}

Ticket summaries:
${ticketText}`;
}

// ---------- Default model ----------

const DEFAULT_MODEL = 'haiku';

// ---------- Engine ----------

export class SummaryEngine {
  private executor: ClaudeExecutor;
  private summaryRepo: SummaryRepository;
  private repoId: number;
  private requestedModel: string | undefined;
  private noCache: boolean;

  constructor(options: SummaryEngineOptions) {
    this.executor = options.executor;
    this.summaryRepo = options.summaryRepo;
    this.repoId = options.repoId;
    this.requestedModel = options.model;
    this.noCache = options.noCache ?? false;
  }

  /**
   * Resolve the model to use for summarization.
   * If --model was specified, use that. Otherwise use DEFAULT_MODEL.
   */
  private resolveModel(): string {
    return this.requestedModel ?? DEFAULT_MODEL;
  }

  /**
   * Check if a cached summary can be used.
   *
   * Rules:
   * - If --no-cache, always re-summarize
   * - If no cached entry exists, summarize fresh
   * - If content hash differs, re-summarize
   * - If --model was specified and differs from cached model, re-summarize
   * - If --model was NOT specified, use cached regardless of model
   */
  private shouldUseCached(
    itemId: string,
    itemType: SummaryItemType,
    contentHash: string
  ): { useCached: boolean; cachedSummary?: string } {
    if (this.noCache) {
      return { useCached: false };
    }

    const cached = this.summaryRepo.findByItem(itemId, itemType, this.repoId);
    if (!cached) {
      return { useCached: false };
    }

    // Hash changed — content is different
    if (cached.content_hash !== contentHash) {
      return { useCached: false };
    }

    // If --model was specified and differs from cached, re-summarize
    if (this.requestedModel && cached.model !== this.requestedModel) {
      return { useCached: false };
    }

    return { useCached: true, cachedSummary: cached.summary };
  }

  /**
   * Summarize a single stage.
   */
  summarizeStage(stage: StageSummaryInput): SummaryResult {
    const contentHash = computeHash(stage.file_content);
    const { useCached, cachedSummary } = this.shouldUseCached(stage.id, 'stage', contentHash);

    if (useCached && cachedSummary !== undefined) {
      return {
        id: stage.id,
        type: 'stage',
        title: stage.title,
        summary: cachedSummary,
        cached: true,
      };
    }

    const model = this.resolveModel();
    let summary: string;
    try {
      const prompt = buildStagePrompt(stage);
      summary = this.executor.execute(prompt, model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary = `[Error summarizing stage: ${message}]`;
    }

    // Cache the result
    this.summaryRepo.upsert({
      item_id: stage.id,
      item_type: 'stage',
      content_hash: contentHash,
      model,
      summary,
      repo_id: this.repoId,
    });

    return {
      id: stage.id,
      type: 'stage',
      title: stage.title,
      summary,
      cached: false,
    };
  }

  /**
   * Summarize a ticket by first summarizing its stages, then combining.
   */
  summarizeTicket(ticket: TicketSummaryInput): {
    ticketResult: SummaryResult;
    stageResults: SummaryResult[];
  } {
    // First, summarize all stages
    const stageResults = ticket.stages.map((s) => this.summarizeStage(s));

    // Compute ticket content hash from sorted stage summaries
    const sortedStageSummaries = stageResults
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => r.summary);
    const ticketContentHash = computeHash(sortedStageSummaries.join('\n'));

    const { useCached, cachedSummary } = this.shouldUseCached(
      ticket.id,
      'ticket',
      ticketContentHash
    );

    if (useCached && cachedSummary !== undefined) {
      return {
        ticketResult: {
          id: ticket.id,
          type: 'ticket',
          title: ticket.title,
          summary: cachedSummary,
          cached: true,
        },
        stageResults,
      };
    }

    const model = this.resolveModel();
    let summary: string;
    try {
      const prompt = buildTicketPrompt(ticket, sortedStageSummaries);
      summary = this.executor.execute(prompt, model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary = `[Error summarizing ticket: ${message}]`;
    }

    this.summaryRepo.upsert({
      item_id: ticket.id,
      item_type: 'ticket',
      content_hash: ticketContentHash,
      model,
      summary,
      repo_id: this.repoId,
    });

    return {
      ticketResult: {
        id: ticket.id,
        type: 'ticket',
        title: ticket.title,
        summary,
        cached: false,
      },
      stageResults,
    };
  }

  /**
   * Summarize an epic by first summarizing its tickets, then combining.
   */
  summarizeEpic(epic: EpicSummaryInput): {
    epicResult: SummaryResult;
    ticketResults: SummaryResult[];
    stageResults: SummaryResult[];
  } {
    const allStageResults: SummaryResult[] = [];
    const ticketResults: SummaryResult[] = [];

    for (const ticket of epic.tickets) {
      const { ticketResult, stageResults } = this.summarizeTicket(ticket);
      ticketResults.push(ticketResult);
      allStageResults.push(...stageResults);
    }

    // Compute epic content hash from sorted ticket summaries
    const sortedTicketSummaries = ticketResults
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => r.summary);
    const epicContentHash = computeHash(sortedTicketSummaries.join('\n'));

    const { useCached, cachedSummary } = this.shouldUseCached(
      epic.id,
      'epic',
      epicContentHash
    );

    if (useCached && cachedSummary !== undefined) {
      return {
        epicResult: {
          id: epic.id,
          type: 'epic',
          title: epic.title,
          summary: cachedSummary,
          cached: true,
        },
        ticketResults,
        stageResults: allStageResults,
      };
    }

    const model = this.resolveModel();
    let summary: string;
    try {
      const prompt = buildEpicPrompt(epic, sortedTicketSummaries);
      summary = this.executor.execute(prompt, model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary = `[Error summarizing epic: ${message}]`;
    }

    this.summaryRepo.upsert({
      item_id: epic.id,
      item_type: 'epic',
      content_hash: epicContentHash,
      model,
      summary,
      repo_id: this.repoId,
    });

    return {
      epicResult: {
        id: epic.id,
        type: 'epic',
        title: epic.title,
        summary,
        cached: false,
      },
      ticketResults,
      stageResults: allStageResults,
    };
  }
}
