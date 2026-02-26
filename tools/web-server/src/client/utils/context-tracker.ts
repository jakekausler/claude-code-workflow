import type { ChatItem, AIGroup, UserGroup } from '../types/groups.js';
import type { TokensByCategory, ContextStats, ContextPhaseInfo } from '../types/session.js';
import { estimateTokens } from './tool-linking-engine.js';

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
 */
export function processSessionContextWithPhases(
  items: ChatItem[],
): ContextResult {
  const statsMap = new Map<string, ContextStats>();
  const phases: ContextPhaseInfo[] = [];

  let turnIndex = 0;
  let phaseIndex = 0;
  let phaseStartTurn = 0;
  let previousUserGroup: UserGroup | null = null;
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
      continue;
    }

    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    if (item.type === 'ai') {
      const aiGroup = item.group;
      const turnTokens = computeTurnTokens(aiGroup, previousUserGroup);
      addCategory(cumulative, turnTokens);

      statsMap.set(aiGroup.id, {
        turnIndex,
        cumulativeTokens: { ...cumulative },
        turnTokens,
        totalTokens: sumCategory(cumulative),
      });

      turnIndex++;
      previousUserGroup = null;
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
 */
function computeTurnTokens(
  aiGroup: AIGroup,
  userGroup: UserGroup | null,
): TokensByCategory {
  const tokens = emptyCategory();

  // Attribute user content
  if (userGroup) {
    attributeUserGroup(userGroup, tokens);
  }

  // Attribute AI steps
  attributeAISteps(aiGroup, tokens);

  return tokens;
}

/**
 * Attribute user group content to token categories.
 *
 * Uses coarse-grained attribution: each user group is assigned to exactly
 * one bucket based on precedence (claudeMd > mentionedFiles > userMessages).
 */
function attributeUserGroup(
  userGroup: UserGroup,
  tokens: TokensByCategory,
): void {
  const rawText = userGroup.content.rawText ?? userGroup.content.text ?? '';

  // Check for CLAUDE.md system injection patterns (not casual mentions of "CLAUDE.md" in chat).
  // Matches: full system injections with "Contents of" text, or system-reminder blocks
  const isClaudeMdInjection =
    (rawText.includes('Contents of') && rawText.includes('CLAUDE.md')) ||
    rawText.includes('<system-reminder>');
  if (isClaudeMdInjection) {
    tokens.claudeMd += estimateTokens(rawText);
  } else if (userGroup.content.fileReferences.length > 0) {
    tokens.mentionedFiles += estimateTokens(rawText);
  } else {
    tokens.userMessages += estimateTokens(rawText);
  }
}

/**
 * Attribute AI group steps to token categories.
 *
 * - thinking / output steps -> thinkingText
 * - tool_call steps -> toolOutputs or taskCoordination (based on tool name)
 * - tool_result steps -> toolOutputs
 */
function attributeAISteps(
  aiGroup: AIGroup,
  tokens: TokensByCategory,
): void {
  for (const step of aiGroup.steps) {
    switch (step.type) {
      case 'thinking':
      case 'output':
        // Both thinking and visible output text are attributed to thinkingText.
        // This matches devtools' approach of grouping all model-generated text
        // into a single category. The field name is inherited from the server-side
        // TokensByCategory type which is used across the pipeline.
        tokens.thinkingText += estimateTokens(step.content);
        break;

      case 'tool_call':
        if (step.toolName && COORD_TOOLS.has(step.toolName)) {
          tokens.taskCoordination += estimateTokens(step.content);
        } else {
          tokens.toolOutputs += estimateTokens(step.content);
        }
        break;

      case 'tool_result':
        if (step.toolName && COORD_TOOLS.has(step.toolName)) {
          tokens.taskCoordination += estimateTokens(step.content);
        } else {
          tokens.toolOutputs += estimateTokens(step.content);
        }
        break;

      // subagent steps: skip (subagent token usage is tracked separately)
    }
  }
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
