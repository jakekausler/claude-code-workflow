import type {
  Chunk,
  AIChunk,
  UserChunk,
  TokensByCategory,
  ContextStats,
  ContextPhaseInfo,
  ParsedMessage,
} from '../types/jsonl.js';

/** Tools whose input tokens count as task-coordination overhead rather than tool output. */
const COORD_TOOLS = new Set([
  'Task',
  'SendMessage',
  'TeamCreate',
  'TaskCreate',
  'TaskUpdate',
]);

export function trackContext(chunks: Chunk[]): {
  perTurn: ContextStats[];
  phases: ContextPhaseInfo[];
} {
  const perTurn: ContextStats[] = [];
  const phases: ContextPhaseInfo[] = [];

  let turnIndex = 0;
  let phaseIndex = 0;
  let phaseStartTurn = 0;
  const cumulative: TokensByCategory = emptyCategory();

  /** Add turnTokens to cumulative, push a ContextStats entry, and advance turnIndex. */
  function recordTurn(turnTokens: TokensByCategory): void {
    addCategory(cumulative, turnTokens);
    perTurn.push({
      turnIndex,
      cumulativeTokens: { ...cumulative },
      turnTokens,
      totalTokens: sumCategory(cumulative),
    });
    turnIndex++;
  }

  for (const chunk of chunks) {
    if (chunk.type === 'compact') {
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
      // Start new phase
      phaseIndex++;
      phaseStartTurn = turnIndex;
      // Reset cumulative (compacted away)
      resetCategory(cumulative);
      continue;
    }

    if (chunk.type === 'ai') {
      recordTurn(attributeAIChunk(chunk));
    } else if (chunk.type === 'user') {
      recordTurn(attributeUserChunk(chunk));
    }
    // system chunks: skip for context tracking (they are command output, not token-consuming)
  }

  // Close final phase
  if (turnIndex > phaseStartTurn) {
    phases.push({
      phaseIndex,
      startTurn: phaseStartTurn,
      endTurn: turnIndex - 1,
      compactedTokens: 0, // Last phase not compacted
      label: `Phase ${phaseIndex + 1}`,
    });
  }

  return { perTurn, phases };
}

function attributeAIChunk(chunk: AIChunk): TokensByCategory {
  const tokens = emptyCategory();

  for (const msg of chunk.messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        // thinkingText intentionally groups both thinking blocks and text output
        // blocks together as "thinking + text output tokens" per the design spec.
        if (block.type === 'thinking') {
          tokens.thinkingText += estimateTokens(block.thinking);
        } else if (block.type === 'text') {
          tokens.thinkingText += estimateTokens(block.text);
        } else if (block.type === 'tool_use') {
          if (COORD_TOOLS.has(block.name)) {
            tokens.taskCoordination += estimateTokens(
              JSON.stringify(block.input),
            );
          } else {
            tokens.toolOutputs += estimateTokens(JSON.stringify(block.input));
          }
        }
      }
    }

    // Tool result messages (isMeta user entries in AI chunks)
    if (msg.type === 'user' && msg.isMeta) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const resultText =
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
            tokens.toolOutputs += estimateTokens(resultText);
          }
        }
      }
    }
  }

  return tokens;
}

function attributeUserChunk(chunk: UserChunk): TokensByCategory {
  const tokens = emptyCategory();
  const msg = chunk.message;

  if (typeof msg.content === 'string') {
    const content = msg.content;

    // Intentional coarse-grained attribution: each chunk is assigned to exactly
    // one bucket based on precedence (claudeMd > mentionedFiles > userMessages).
    // Mixed content is attributed to the highest-priority matching bucket.

    // Check for CLAUDE.md content
    if (content.includes('CLAUDE.md') || content.includes('<system-reminder>')) {
      tokens.claudeMd += estimateTokens(content);
    }
    // Check for @-mentioned files.
    // Note: the /@[\w./\\-]+/ regex may false-positive on email addresses,
    // but this is acceptable for rough token estimation purposes.
    else if (content.includes('@') && content.match(/@[\w./\\-]+/)) {
      tokens.mentionedFiles += estimateTokens(content);
    }
    // Regular user message
    else {
      tokens.userMessages += estimateTokens(content);
    }
  }

  return tokens;
}

/** Rough token estimation: ~4 UTF-16 code units per token (text.length counts code units, not characters). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
