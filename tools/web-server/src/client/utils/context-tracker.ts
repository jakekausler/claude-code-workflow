import type { ChatItem, AIGroup, AIGroupLastOutput, UserGroup } from '../types/groups.js';
import type {
  TokensByCategory,
  ContextStats,
  ContextPhaseInfo,
  ContextItemDetail,
  ToolTokenBreakdown,
  ThinkingTextBreakdown,
  ClaudeMdFileEstimate,
  MentionedFileEstimate,
  SemanticStep,
} from '../types/session.js';
import { estimateTokens, linkToolCallsToResults } from './tool-linking-engine.js';
import { findLastOutput } from './last-output-detector.js';

/** Tools whose input tokens count as task-coordination overhead rather than tool output. */
const COORD_TOOLS = new Set([
  'Task',
  'SendMessage',
  'TeamCreate',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TeamDelete',
]);

/** Per-item breakdowns computed alongside category totals for a single turn. */
interface TurnBreakdowns {
  claudeMdItems: ContextItemDetail[];
  mentionedFileItems: ContextItemDetail[];
  toolOutputItems: ToolTokenBreakdown[];
  taskCoordinationItems: ContextItemDetail[];
  thinkingTextDetail: ThinkingTextBreakdown;
  userMessageItems: ContextItemDetail[];
}

function emptyBreakdowns(): TurnBreakdowns {
  return {
    claudeMdItems: [],
    mentionedFileItems: [],
    toolOutputItems: [],
    taskCoordinationItems: [],
    thinkingTextDetail: { thinking: 0, text: 0 },
    userMessageItems: [],
  };
}

export interface ContextResult {
  statsMap: Map<string, ContextStats>;
  phases: ContextPhaseInfo[];
}

/**
 * Process ChatItem[] to compute per-AI-group context stats with phase awareness.
 *
 * Walks the items array in order. Each AI group gets a ContextStats entry
 * keyed by its id. Compact groups create phase boundaries that reset
 * cumulative token counts. User groups contribute tokens to the next AI
 * group's turn.
 *
 * @param claudeMdFiles - CLAUDE.md files discovered on disk by the server.
 *   These are injected by Claude Code at API time but NOT stored in the JSONL.
 *   When provided, the first AI group in each phase receives claudeMd token
 *   attribution from these files.
 * @param mentionedFileTokens - @-mentioned files read from disk by the server.
 *   Provides accurate token estimates based on actual file content instead of
 *   estimating from the file path string alone.
 */
export function processSessionContextWithPhases(
  items: ChatItem[],
  claudeMdFiles?: ClaudeMdFileEstimate[],
  mentionedFileTokens?: MentionedFileEstimate[],
): ContextResult {
  const statsMap = new Map<string, ContextStats>();
  const phases: ContextPhaseInfo[] = [];

  // Build a lookup map for mentioned file token estimates from the server.
  // Keys are the raw paths (as they appear in @-mentions). Values are token counts.
  const mentionedFileLookup = new Map<string, number>();
  if (mentionedFileTokens) {
    for (const mf of mentionedFileTokens) {
      mentionedFileLookup.set(mf.path, mf.estimatedTokens);
    }
  }

  let turnIndex = 0;
  let phaseIndex = 0;
  let phaseStartTurn = 0;
  let previousUserGroup: UserGroup | null = null;
  let isFirstAIGroupInPhase = true;
  const cumulative: TokensByCategory = emptyCategory();

  for (const item of items) {
    if (item.type === 'compact') {
      // Close current phase
      if (turnIndex > phaseStartTurn) {
        phases.push({
          phaseIndex,
          startTurn: phaseStartTurn,
          endTurn: turnIndex - 1,
          compactedTokens: sumCategory(cumulative),
          label: `Phase ${phaseIndex + 1}`,
        });
      }
      phaseIndex++;
      phaseStartTurn = turnIndex;
      resetCategory(cumulative);
      previousUserGroup = null;
      isFirstAIGroupInPhase = true;
      continue;
    }

    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    if (item.type === 'ai') {
      const aiGroup = item.group;
      const { tokens: turnTokens, breakdowns } = computeTurnTokens(aiGroup, previousUserGroup, mentionedFileLookup);

      // Inject CLAUDE.md files from disk for the first AI group in each phase.
      // Claude Code injects these at API time but they are NOT in the JSONL,
      // so content-based detection in attributeUserGroup() never finds them.
      // Only inject if the user message didn't already detect CLAUDE.md content
      // (e.g., from test data where rawText contains "Contents of" patterns).
      if (isFirstAIGroupInPhase && claudeMdFiles && claudeMdFiles.length > 0 && breakdowns.claudeMdItems.length === 0) {
        for (const file of claudeMdFiles) {
          breakdowns.claudeMdItems.push({ label: file.path, tokens: file.estimatedTokens });
          turnTokens.claudeMd += file.estimatedTokens;
        }
      }

      addCategory(cumulative, turnTokens);

      statsMap.set(aiGroup.id, {
        turnIndex,
        cumulativeTokens: { ...cumulative },
        turnTokens,
        totalTokens: sumCategory(cumulative),
        claudeMdItems: breakdowns.claudeMdItems.length > 0 ? breakdowns.claudeMdItems : undefined,
        mentionedFileItems: breakdowns.mentionedFileItems.length > 0 ? breakdowns.mentionedFileItems : undefined,
        toolOutputItems: breakdowns.toolOutputItems.length > 0 ? breakdowns.toolOutputItems : undefined,
        taskCoordinationItems: breakdowns.taskCoordinationItems.length > 0 ? breakdowns.taskCoordinationItems : undefined,
        thinkingTextDetail: (breakdowns.thinkingTextDetail.thinking > 0 || breakdowns.thinkingTextDetail.text > 0)
          ? breakdowns.thinkingTextDetail : undefined,
        userMessageItems: breakdowns.userMessageItems.length > 0 ? breakdowns.userMessageItems : undefined,
      });

      turnIndex++;
      previousUserGroup = null;
      isFirstAIGroupInPhase = false;
    }
    // system items: skip for context tracking
  }

  // Close final phase
  if (turnIndex > phaseStartTurn) {
    phases.push({
      phaseIndex,
      startTurn: phaseStartTurn,
      endTurn: turnIndex - 1,
      compactedTokens: 0,
      label: `Phase ${phaseIndex + 1}`,
    });
  }

  return { statsMap, phases };
}

/**
 * Compute per-turn token attribution for an AI group and its preceding user group.
 * Returns both category totals and per-item breakdowns.
 *
 * @param mentionedFileLookup - Pre-computed token estimates for @-mentioned files
 *   keyed by the raw path as it appears in user messages.
 */
function computeTurnTokens(
  aiGroup: AIGroup,
  userGroup: UserGroup | null,
  mentionedFileLookup?: Map<string, number>,
): { tokens: TokensByCategory; breakdowns: TurnBreakdowns } {
  const tokens = emptyCategory();
  const breakdowns = emptyBreakdowns();

  // Attribute user content
  if (userGroup) {
    attributeUserGroup(userGroup, tokens, breakdowns, mentionedFileLookup);
  }

  // Attribute AI steps
  attributeAISteps(aiGroup, tokens, breakdowns);

  return { tokens, breakdowns };
}

/**
 * Attribute user group content to token categories by extracting sections.
 *
 * Strategy: extract all identifiable injected content (CLAUDE.md sections,
 * system-reminder blocks, mentioned file content) from rawText. Whatever
 * remains after stripping those sections is the user's own typed text.
 * Each category is estimated independently from its extracted text.
 *
 * @param mentionedFileLookup - Pre-computed token estimates for @-mentioned files
 *   keyed by the raw path. When available, overrides the fallback estimation
 *   which only estimates from path strings (~87 tokens) rather than actual
 *   file content (~4.9k tokens).
 */
function attributeUserGroup(
  userGroup: UserGroup,
  tokens: TokensByCategory,
  breakdowns: TurnBreakdowns,
  mentionedFileLookup?: Map<string, number>,
): void {
  const rawText = userGroup.content.rawText ?? userGroup.content.text ?? '';
  if (rawText.length === 0) return;

  // Track all extracted ranges so we can compute the remainder (user message text).
  // Each range is [startIndex, endIndex) in rawText.
  const extractedRanges: Array<[number, number]> = [];

  // ─── 1. Extract CLAUDE.md sections ──────────────────────────────────────────
  //
  // CLAUDE.md content appears as "Contents of <path>" headers followed by file
  // content until the next "Contents of" header or end of text. We split on ALL
  // "Contents of" boundaries and only keep sections whose path ends with CLAUDE.md.
  //
  // We use a regex that matches each "Contents of <path>" line to find boundaries.
  // Match "Contents of <path>" where path is a non-whitespace token (file paths don't have spaces).
  // This captures the path accurately even when followed by descriptions like "(user's private ...):"
  const contentsOfRegex = /Contents of (\S+)/g;
  const contentsOfMatches: Array<{ index: number; path: string; matchLen: number }> = [];
  let contentsMatch: RegExpExecArray | null;
  while ((contentsMatch = contentsOfRegex.exec(rawText)) !== null) {
    contentsOfMatches.push({
      index: contentsMatch.index,
      path: contentsMatch[1],
      matchLen: contentsMatch[0].length,
    });
  }

  // For each "Contents of" match, the section runs from this match's start
  // to the next "Contents of" match's start (or end of text).
  const claudeMdSectionTexts: string[] = [];
  for (let i = 0; i < contentsOfMatches.length; i++) {
    const start = contentsOfMatches[i].index;
    const end = i + 1 < contentsOfMatches.length
      ? contentsOfMatches[i + 1].index
      : rawText.length;
    const path = contentsOfMatches[i].path;

    if (path.endsWith('CLAUDE.md')) {
      const sectionText = rawText.slice(start, end);
      claudeMdSectionTexts.push(sectionText);
      extractedRanges.push([start, end]);

      const sectionTokens = estimateTokens(sectionText);
      breakdowns.claudeMdItems.push({ label: path, tokens: sectionTokens });
      tokens.claudeMd += sectionTokens;
    }
  }

  // ─── 2. Extract <system-reminder> blocks ────────────────────────────────────
  const sysReminderRegex = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
  let sysMatch: RegExpExecArray | null;
  while ((sysMatch = sysReminderRegex.exec(rawText)) !== null) {
    const block = sysMatch[0];
    const blockStart = sysMatch.index;
    const blockEnd = blockStart + block.length;

    // Avoid double-counting if this system-reminder is inside a CLAUDE.md section
    const alreadyCovered = claudeMdSectionTexts.some(section => section.includes(block));
    if (!alreadyCovered) {
      const blockTokens = estimateTokens(block);
      breakdowns.claudeMdItems.push({ label: 'system-reminder', tokens: blockTokens });
      tokens.claudeMd += blockTokens;
      extractedRanges.push([blockStart, blockEnd]);
    }
  }

  // ─── 3. Extract mentioned file content ──────────────────────────────────────
  //
  // When files are @-mentioned, their content is injected into the rawText.
  // We look for "Contents of" sections whose path matches a file reference
  // (non-CLAUDE.md files) and also try to match file content that may appear
  // inline without a "Contents of" header.
  const fileRefs = userGroup.content.fileReferences;
  if (fileRefs.length > 0) {
    // First: check "Contents of" sections for non-CLAUDE.md files that match file references
    for (let i = 0; i < contentsOfMatches.length; i++) {
      const start = contentsOfMatches[i].index;
      const end = i + 1 < contentsOfMatches.length
        ? contentsOfMatches[i + 1].index
        : rawText.length;
      const path = contentsOfMatches[i].path;

      // Skip CLAUDE.md sections (already handled above)
      if (path.endsWith('CLAUDE.md')) continue;

      // Check if this path matches any file reference
      const matchesRef = fileRefs.some(ref =>
        path.endsWith(ref.path) || ref.path.endsWith(path) || path.includes(ref.path) || ref.path.includes(path),
      );
      if (matchesRef) {
        const sectionText = rawText.slice(start, end);
        const sectionTokens = estimateTokens(sectionText);
        breakdowns.mentionedFileItems.push({ label: path, tokens: sectionTokens });
        tokens.mentionedFiles += sectionTokens;
        extractedRanges.push([start, end]);
      }
    }

    // If no "Contents of" sections matched file references, use server-provided
    // token estimates (from reading actual file content on disk) or fall back to
    // text-based heuristic.
    if (breakdowns.mentionedFileItems.length === 0) {
      let usedServerEstimates = false;

      // Prefer server-provided estimates from actual file content on disk.
      // This gives accurate token counts (~4.9k) instead of path-string estimates (~87).
      if (mentionedFileLookup && mentionedFileLookup.size > 0) {
        for (const ref of fileRefs) {
          const serverTokens = lookupMentionedFileTokens(ref.path, mentionedFileLookup);
          if (serverTokens !== undefined) {
            breakdowns.mentionedFileItems.push({ label: ref.path, tokens: serverTokens });
            tokens.mentionedFiles += serverTokens;
            usedServerEstimates = true;
          }
        }
      }

      // Fall back to text-based heuristic if no server estimates matched.
      if (!usedServerEstimates) {
        const remainderAfterClaudeMd = computeRemainderText(rawText, extractedRanges);
        const remainderTokens = estimateTokens(remainderAfterClaudeMd);

        for (const ref of fileRefs) {
          const perFileTokens = Math.ceil(remainderTokens / fileRefs.length);
          breakdowns.mentionedFileItems.push({ label: ref.path, tokens: perFileTokens });
          tokens.mentionedFiles += perFileTokens;
        }
      }
    }
  }

  // ─── 4. User message: remainder after stripping all extracted sections ──────
  const remainderText = computeRemainderText(rawText, extractedRanges);
  const userMessageTokens = estimateTokens(remainderText);
  if (userMessageTokens > 0) {
    tokens.userMessages += userMessageTokens;
    const preview = remainderText.length > 80
      ? remainderText.slice(0, 80).trim() + '...'
      : remainderText.trim();
    breakdowns.userMessageItems.push({ label: preview || '(user message)', tokens: userMessageTokens });
  }
}

/**
 * Compute the text remaining after removing all extracted ranges.
 * Ranges are [start, end) indices into the original text.
 */
function computeRemainderText(
  text: string,
  ranges: Array<[number, number]>,
): string {
  if (ranges.length === 0) return text;

  // Sort ranges by start index and merge overlaps
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }

  // Build remainder from gaps between merged ranges
  const parts: string[] = [];
  let pos = 0;
  for (const [start, end] of merged) {
    if (pos < start) {
      parts.push(text.slice(pos, start));
    }
    pos = end;
  }
  if (pos < text.length) {
    parts.push(text.slice(pos));
  }

  return parts.join('');
}

/**
 * Attribute AI group steps to token categories.
 *
 * **Thinking/text**: Counts tokens from SemanticSteps of type 'thinking' and
 * 'output'. This matches devtools' approach which uses display items built
 * from steps — only pure thinking blocks and final text output are counted,
 * NOT text blocks interleaved with tool_use blocks in assistant messages.
 *
 * **Tool tokens**: Uses linked tool data from `linkToolCallsToResults` which
 * pre-computes callTokens (from name + JSON input), result.tokenCount (from
 * actual result content), and skillInstructionsTokenCount. Falls back to
 * step.content estimation for tool steps without toolCallId.
 *
 * Each tool_call + its corresponding tool_result creates ONE entry in the
 * breakdown array. Multiple calls to the same tool produce separate entries.
 */
function attributeAISteps(
  aiGroup: AIGroup,
  tokens: TokensByCategory,
  breakdowns: TurnBreakdowns,
): void {
  // ─── 1. Thinking & text ────────────────────────────────────────────────────
  //
  // Count from SemanticSteps, which classify content into distinct types.
  // Only 'thinking' and 'output' steps contribute to this category.
  //
  // IMPORTANT: Skip the last output step. Devtools builds display items
  // that exclude the "lastOutput" (the final text response shown as the
  // chat bubble), and then aggregateThinkingText iterates those filtered
  // display items. We replicate that by finding the last output step and
  // excluding it from the count.
  const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing);
  const lastOutputStepIndex = findLastOutputStepIndex(aiGroup.steps, lastOutput);

  for (let i = 0; i < aiGroup.steps.length; i++) {
    if (i === lastOutputStepIndex) continue;

    const step = aiGroup.steps[i];
    if (step.type === 'thinking') {
      const stepTokens = estimateTokens(step.content);
      tokens.thinkingText += stepTokens;
      breakdowns.thinkingTextDetail.thinking += stepTokens;
    } else if (step.type === 'output') {
      const stepTokens = estimateTokens(step.content);
      tokens.thinkingText += stepTokens;
      breakdowns.thinkingTextDetail.text += stepTokens;
    }
  }

  // ─── 2. Tool tokens ───────────────────────────────────────────────────────
  //
  // Use linked tool data for accurate estimates. LinkedToolItemData computes:
  //   - callTokens: from tool name + JSON.stringify(actual input params)
  //   - result.tokenCount: from actual result content (not step summary)
  //   - skillInstructionsTokenCount: from skill instruction text
  //
  // For tool steps without toolCallId (can't be linked), fall back to
  // step.content estimation.
  const linkedTools = linkToolCallsToResults(aiGroup.steps, aiGroup.responses);
  const linkedToolCallIds = new Set(linkedTools.keys());

  // Attribute linked tools
  for (const [, tool] of linkedTools) {
    const isCoord = COORD_TOOLS.has(tool.name);
    const toolTokens = (tool.callTokens ?? 0)
      + (tool.result?.tokenCount ?? 0)
      + (tool.skillInstructionsTokenCount ?? 0);

    if (isCoord) {
      tokens.taskCoordination += toolTokens;
      breakdowns.taskCoordinationItems.push({ label: tool.name, tokens: toolTokens });
    } else {
      tokens.toolOutputs += toolTokens;
      breakdowns.toolOutputItems.push({ toolName: tool.name, tokenCount: toolTokens });
    }
  }

  // Attribute unlinked tool steps (those without toolCallId that linkToolCallsToResults skips)
  const perUnlinkedAccum = new Map<string, { toolName: string; tokens: number; isCoord: boolean }>();
  let unlinkedIndex = 0;

  for (const step of aiGroup.steps) {
    // Skip steps that were handled by linked tools
    if (step.toolCallId && linkedToolCallIds.has(step.toolCallId)) continue;

    if (step.type === 'tool_call' || step.type === 'tool_result') {
      const name = step.toolName ?? 'unknown';
      const isCoord = step.toolName ? COORD_TOOLS.has(step.toolName) : false;
      const stepTokens = estimateTokens(step.content);
      const key = step.toolCallId ?? `_unlinked_${unlinkedIndex++}`;

      if (isCoord) {
        tokens.taskCoordination += stepTokens;
      } else {
        tokens.toolOutputs += stepTokens;
      }

      const existing = perUnlinkedAccum.get(key);
      if (existing) {
        existing.tokens += stepTokens;
      } else {
        perUnlinkedAccum.set(key, { toolName: name, tokens: stepTokens, isCoord });
      }
    }
  }

  // Convert unlinked tool accumulator into breakdown arrays
  for (const [, { toolName, tokens: callTokens, isCoord }] of perUnlinkedAccum) {
    if (isCoord) {
      breakdowns.taskCoordinationItems.push({ label: toolName, tokens: callTokens });
    } else {
      breakdowns.toolOutputItems.push({ toolName, tokenCount: callTokens });
    }
  }
}

// ─── Last output step index helper ────────────────────────────────────────────

/**
 * Find the index of the step that produced lastOutput.
 * Used to skip that step when counting thinking/text tokens, matching
 * devtools' behavior where buildDisplayItems excludes the lastOutput step
 * and aggregateThinkingText only counts the filtered display items.
 *
 * Returns -1 if no match found.
 */
function findLastOutputStepIndex(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
): number {
  if (!lastOutput) return -1;

  if (lastOutput.type === 'text') {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'output' && steps[i].content === lastOutput.text) return i;
    }
  }

  if (lastOutput.type === 'interruption') {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'interruption') return i;
    }
  }

  if (lastOutput.type === 'plan_exit') {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'tool_call' && steps[i].toolName === 'ExitPlanMode') return i;
    }
  }

  // tool_result and ongoing types don't affect thinking/text counting
  return -1;
}

// ─── Mentioned file lookup helper ─────────────────────────────────────────────

/**
 * Look up a mentioned file's token count from the server-provided map.
 *
 * The lookup keys are raw paths as extracted from @-mentions (e.g., "src/foo.ts",
 * "~/global.md", "/absolute/path.ts"). We try exact match first, then suffix
 * matching to handle path variations.
 */
function lookupMentionedFileTokens(
  refPath: string,
  lookup: Map<string, number>,
): number | undefined {
  // Exact match
  const exact = lookup.get(refPath);
  if (exact !== undefined) return exact;

  // Suffix match: the ref path from the user message might differ slightly
  // from the extracted path (e.g., with/without leading ./)
  for (const [lookupPath, tokenCount] of lookup) {
    if (
      lookupPath.endsWith(refPath) ||
      refPath.endsWith(lookupPath) ||
      lookupPath.includes(refPath) ||
      refPath.includes(lookupPath)
    ) {
      return tokenCount;
    }
  }

  return undefined;
}

// ─── Category helpers ────────────────────────────────────────────────────────

function emptyCategory(): TokensByCategory {
  return {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
  };
}

function sumCategory(cat: TokensByCategory): number {
  return (
    cat.claudeMd +
    cat.mentionedFiles +
    cat.toolOutputs +
    cat.thinkingText +
    cat.taskCoordination +
    cat.userMessages
  );
}

function addCategory(
  target: TokensByCategory,
  source: TokensByCategory,
): void {
  target.claudeMd += source.claudeMd;
  target.mentionedFiles += source.mentionedFiles;
  target.toolOutputs += source.toolOutputs;
  target.thinkingText += source.thinkingText;
  target.taskCoordination += source.taskCoordination;
  target.userMessages += source.userMessages;
}

function resetCategory(cat: TokensByCategory): void {
  cat.claudeMd = 0;
  cat.mentionedFiles = 0;
  cat.toolOutputs = 0;
  cat.thinkingText = 0;
  cat.taskCoordination = 0;
  cat.userMessages = 0;
}
