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

export interface ProgressEvent {
  phase: SummaryItemType;
  current: number;
  total: number;
  cached: boolean;
  id: string;
}

export interface SummaryEngineOptions {
  executor: ClaudeExecutor;
  summaryRepo: SummaryRepository;
  repoId: number;
  model?: string;
  noCache?: boolean;
  onProgress?: (event: ProgressEvent) => void;
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
  return `You are a summarization tool. Your entire output will be used verbatim as the summary text. Output ONLY a 2-4 sentence summary. No preamble, no follow-up questions, no meta-commentary, no markdown formatting.

Summarize what was accomplished in this development stage. Focus on: what was designed/decided, what was built, issues encountered, and current status.

Stage: ${stage.title} (${stage.id})
Status: ${stage.status}

FILE CONTENT:
${stage.file_content}`;
}

function buildTicketPrompt(ticket: TicketSummaryInput, stageSummaries: string[]): string {
  const stageText = stageSummaries.join('\n\n');
  return `You are a summarization tool. Your entire output will be used verbatim as the summary text. Output ONLY a 2-4 sentence summary. No preamble, no follow-up questions, no meta-commentary, no markdown formatting.

Summarize this ticket's progress based on its stage summaries. Focus on: overall goal, what's completed, what remains, and notable decisions or issues.

Ticket: ${ticket.title} (${ticket.id})
Status: ${ticket.status}

STAGE SUMMARIES:
${stageText}`;
}

function buildEpicPrompt(epic: EpicSummaryInput, ticketSummaries: string[]): string {
  const ticketText = ticketSummaries.join('\n\n');
  return `You are a summarization tool. Your entire output will be used verbatim as the summary text. Output ONLY a 2-4 sentence summary. No preamble, no follow-up questions, no meta-commentary, no markdown formatting.

Summarize this epic's progress based on its ticket summaries. Focus on: overall objective, progress across tickets, and high-level status.

Epic: ${epic.title} (${epic.id})
Status: ${epic.status}

TICKET SUMMARIES:
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
  private onProgress: ((event: ProgressEvent) => void) | undefined;
  private progressCount = 0;
  private progressTotal = 0;

  constructor(options: SummaryEngineOptions) {
    this.executor = options.executor;
    this.summaryRepo = options.summaryRepo;
    this.repoId = options.repoId;
    this.requestedModel = options.model;
    this.noCache = options.noCache ?? false;
    this.onProgress = options.onProgress;
  }

  /**
   * Set the total number of items that will be summarized.
   * Must be called before summarization begins for progress tracking.
   */
  setProgressTotal(total: number): void {
    this.progressTotal = total;
    this.progressCount = 0;
  }

  private emitProgress(phase: SummaryItemType, cached: boolean, id: string): void {
    if (!this.onProgress) return;
    this.progressCount++;
    this.onProgress({
      phase,
      current: this.progressCount,
      total: this.progressTotal,
      cached,
      id,
    });
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
      const result: SummaryResult = {
        id: stage.id,
        type: 'stage',
        title: stage.title,
        summary: cachedSummary,
        cached: true,
      };
      this.emitProgress('stage', true, stage.id);
      return result;
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

    const result: SummaryResult = {
      id: stage.id,
      type: 'stage',
      title: stage.title,
      summary,
      cached: false,
    };
    this.emitProgress('stage', false, stage.id);
    return result;
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
      const ticketResult: SummaryResult = {
        id: ticket.id,
        type: 'ticket',
        title: ticket.title,
        summary: cachedSummary,
        cached: true,
      };
      this.emitProgress('ticket', true, ticket.id);
      return { ticketResult, stageResults };
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

    const ticketResult: SummaryResult = {
      id: ticket.id,
      type: 'ticket',
      title: ticket.title,
      summary,
      cached: false,
    };
    this.emitProgress('ticket', false, ticket.id);
    return { ticketResult, stageResults };
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
      const epicResult: SummaryResult = {
        id: epic.id,
        type: 'epic',
        title: epic.title,
        summary: cachedSummary,
        cached: true,
      };
      this.emitProgress('epic', true, epic.id);
      return { epicResult, ticketResults, stageResults: allStageResults };
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

    const epicResult: SummaryResult = {
      id: epic.id,
      type: 'epic',
      title: epic.title,
      summary,
      cached: false,
    };
    this.emitProgress('epic', false, epic.id);
    return { epicResult, ticketResults, stageResults: allStageResults };
  }
}
