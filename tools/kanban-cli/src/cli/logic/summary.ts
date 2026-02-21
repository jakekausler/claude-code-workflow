import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { EpicRepository } from '../../db/repositories/epic-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { SummaryRepository } from '../../db/repositories/summary-repository.js';
import { SummaryEngine } from './summary-engine.js';
import type {
  SummaryResult,
  StageSummaryInput,
  TicketSummaryInput,
  EpicSummaryInput,
  ProgressEvent,
} from './summary-engine.js';
import type { ClaudeExecutor } from '../../utils/claude-executor.js';

// ---------- Input / Output types ----------

export interface BuildSummaryInput {
  db: KanbanDatabase;
  repoId: number;
  repoPath: string;
  ids: string[];
  executor: ClaudeExecutor;
  model?: string;
  noCache?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export interface SummaryOutput {
  items: SummaryResult[];
}

// ---------- ID classification ----------

function getIdType(id: string): 'epic' | 'ticket' | 'stage' | 'unknown' {
  if (id.startsWith('STAGE-')) return 'stage';
  if (id.startsWith('TICKET-')) return 'ticket';
  if (id.startsWith('EPIC-')) return 'epic';
  return 'unknown';
}

// ---------- File content reader ----------

export function readStageFileContent(stageFilePath: string, repoPath: string): string | null {
  const filePath = path.isAbsolute(stageFilePath)
    ? stageFilePath
    : path.join(repoPath, stageFilePath);

  try {
    const mainContent = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);
    const mainBasename = path.basename(filePath);

    // Derive the stage ID prefix (e.g. "STAGE-001-001-001" from "STAGE-001-001-001.md")
    const stageIdPrefix = path.basename(filePath, '.md');

    // Find sister files matching STAGE-001-001-001-*.md
    let sisterFiles: string[] = [];
    try {
      const dirEntries = fs.readdirSync(dir);
      sisterFiles = dirEntries.filter(
        (name) =>
          name !== mainBasename &&
          name.startsWith(stageIdPrefix + '-') &&
          name.endsWith('.md')
      );
    } catch {
      // If directory listing fails, just return the main file
    }

    if (sisterFiles.length === 0) {
      // Single file: still include filename header for consistency
      return `--- ${mainBasename} ---\n${mainContent}`;
    }

    // Build array of { basename, fullPath } for main + sisters
    const allFiles = [
      { basename: mainBasename, fullPath: filePath },
      ...sisterFiles.map((name) => ({ basename: name, fullPath: path.join(dir, name) })),
    ];

    // Sort by file modification time (ascending)
    allFiles.sort((a, b) => {
      const aMtime = fs.statSync(a.fullPath).mtimeMs;
      const bMtime = fs.statSync(b.fullPath).mtimeMs;
      return aMtime - bMtime;
    });

    // Concatenate with filename headers
    const parts = allFiles.map((f) => {
      const content = fs.readFileSync(f.fullPath, 'utf-8');
      return `--- ${f.basename} ---\n${content}`;
    });

    return parts.join('\n\n');
  } catch {
    return null;
  }
}

// ---------- Core logic ----------

export function buildSummary(input: BuildSummaryInput): SummaryOutput {
  const { db, repoId, repoPath, ids, executor, model, noCache, onProgress } = input;

  const epicRepo = new EpicRepository(db);
  const ticketRepo = new TicketRepository(db);
  const stageRepo = new StageRepository(db);
  const summaryRepo = new SummaryRepository(db);

  const engine = new SummaryEngine({
    executor,
    summaryRepo,
    repoId,
    model,
    noCache,
    onProgress,
  });

  // Pre-load repo data for lookups
  const allTickets = ticketRepo.listByRepo(repoId);
  const allStages = stageRepo.listByRepo(repoId);

  // Build lookup maps
  const ticketsByEpic = new Map<string, typeof allTickets>();
  for (const t of allTickets) {
    const epicId = t.epic_id ?? '';
    const existing = ticketsByEpic.get(epicId) ?? [];
    existing.push(t);
    ticketsByEpic.set(epicId, existing);
  }

  const stagesByTicket = new Map<string, typeof allStages>();
  const stageMap = new Map<string, (typeof allStages)[0]>();
  for (const s of allStages) {
    stageMap.set(s.id, s);
    const ticketId = s.ticket_id ?? '';
    const existing = stagesByTicket.get(ticketId) ?? [];
    existing.push(s);
    stagesByTicket.set(ticketId, existing);
  }

  // Count total items for progress tracking
  if (onProgress) {
    let totalItems = 0;
    const countedIds = new Set<string>();
    for (const id of ids) {
      if (countedIds.has(id)) continue;
      countedIds.add(id);
      const idType = getIdType(id);
      switch (idType) {
        case 'stage':
          totalItems += 1;
          break;
        case 'ticket': {
          const tStages = stagesByTicket.get(id) ?? [];
          totalItems += tStages.length + 1; // stages + ticket
          break;
        }
        case 'epic': {
          const eTickets = ticketsByEpic.get(id) ?? [];
          for (const t of eTickets) {
            const tStages = stagesByTicket.get(t.id) ?? [];
            totalItems += tStages.length + 1; // stages + ticket
          }
          totalItems += 1; // the epic itself
          break;
        }
        default:
          break;
      }
    }
    engine.setProgressTotal(totalItems);
  }

  const results: SummaryResult[] = [];
  const processedIds = new Set<string>();

  for (const id of ids) {
    if (processedIds.has(id)) continue;
    processedIds.add(id);

    const idType = getIdType(id);

    switch (idType) {
      case 'stage': {
        const stageRow = stageMap.get(id);
        if (!stageRow) {
          process.stderr.write(`Warning: Stage ${id} not found in database -- skipping\n`);
          break;
        }

        const fileContent = readStageFileContent(stageRow.file_path, repoPath);
        if (fileContent === null) {
          process.stderr.write(`Warning: Cannot read file for ${id} -- skipping\n`);
          break;
        }

        const stageInput: StageSummaryInput = {
          id: stageRow.id,
          title: stageRow.title ?? '',
          status: stageRow.status ?? 'Not Started',
          file_content: fileContent,
        };

        results.push(engine.summarizeStage(stageInput));
        break;
      }

      case 'ticket': {
        const ticketRow = allTickets.find((t) => t.id === id);
        if (!ticketRow) {
          process.stderr.write(`Warning: Ticket ${id} not found in database -- skipping\n`);
          break;
        }

        const ticketStages = stagesByTicket.get(id) ?? [];
        const stageInputs: StageSummaryInput[] = [];

        for (const s of ticketStages) {
          const fileContent = readStageFileContent(s.file_path, repoPath);
          if (fileContent === null) {
            process.stderr.write(`Warning: Cannot read file for ${s.id} -- skipping\n`);
            continue;
          }
          stageInputs.push({
            id: s.id,
            title: s.title ?? '',
            status: s.status ?? 'Not Started',
            file_content: fileContent,
          });
        }

        const ticketInput: TicketSummaryInput = {
          id: ticketRow.id,
          title: ticketRow.title ?? '',
          status: ticketRow.status ?? 'Not Started',
          stages: stageInputs,
        };

        const { ticketResult, stageResults } = engine.summarizeTicket(ticketInput);
        results.push(...stageResults);
        results.push(ticketResult);
        break;
      }

      case 'epic': {
        const epicRow = epicRepo.findById(id);
        if (!epicRow) {
          process.stderr.write(`Warning: Epic ${id} not found in database -- skipping\n`);
          break;
        }

        const epicTickets = ticketsByEpic.get(id) ?? [];
        const ticketInputs: TicketSummaryInput[] = [];

        for (const t of epicTickets) {
          const tStages = stagesByTicket.get(t.id) ?? [];
          const stageInputs: StageSummaryInput[] = [];

          for (const s of tStages) {
            const fileContent = readStageFileContent(s.file_path, repoPath);
            if (fileContent === null) {
              process.stderr.write(`Warning: Cannot read file for ${s.id} -- skipping\n`);
              continue;
            }
            stageInputs.push({
              id: s.id,
              title: s.title ?? '',
              status: s.status ?? 'Not Started',
              file_content: fileContent,
            });
          }

          ticketInputs.push({
            id: t.id,
            title: t.title ?? '',
            status: t.status ?? 'Not Started',
            stages: stageInputs,
          });
        }

        const epicInput: EpicSummaryInput = {
          id: epicRow.id,
          title: epicRow.title ?? '',
          status: epicRow.status ?? 'Not Started',
          tickets: ticketInputs,
        };

        const { epicResult, ticketResults, stageResults } = engine.summarizeEpic(epicInput);
        results.push(...stageResults);
        results.push(...ticketResults);
        results.push(epicResult);
        break;
      }

      default: {
        process.stderr.write(`Warning: Unknown ID format "${id}" -- skipping\n`);
      }
    }
  }

  return { items: results };
}
