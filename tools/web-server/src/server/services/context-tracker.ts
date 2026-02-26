import type {
  Chunk,
  AIChunk,
  UserChunk,
  TokensByCategory,
  ContextStats,
  ContextPhaseInfo,
  ContextItemDetail,
  ToolTokenBreakdown,
  ThinkingTextBreakdown,
  ParsedMessage,
} from '../types/jsonl.js';

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
  function recordTurn(turnTokens: TokensByCategory, breakdowns: TurnBreakdowns): void {
    addCategory(cumulative, turnTokens);
    perTurn.push({
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
      const { tokens, breakdowns } = attributeAIChunk(chunk);
      recordTurn(tokens, breakdowns);
    } else if (chunk.type === 'user') {
      const { tokens, breakdowns } = attributeUserChunk(chunk);
      recordTurn(tokens, breakdowns);
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

function attributeAIChunk(chunk: AIChunk): { tokens: TokensByCategory; breakdowns: TurnBreakdowns } {
  const tokens = emptyCategory();
  const breakdowns = emptyBreakdowns();

  // Map tool_use id → { name, tokens } so tool_result blocks can be paired back
  // to the originating tool call. Each call gets its own breakdown entry.
  const toolCallMap = new Map<string, { name: string; tokens: number; isCoord: boolean }>();

  for (const msg of chunk.messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'thinking') {
          const toks = estimateTokens(block.thinking);
          tokens.thinkingText += toks;
          breakdowns.thinkingTextDetail.thinking += toks;
        } else if (block.type === 'text') {
          const toks = estimateTokens(block.text);
          tokens.thinkingText += toks;
          breakdowns.thinkingTextDetail.text += toks;
        } else if (block.type === 'tool_use') {
          const inputStr = JSON.stringify(block.input);
          const toks = estimateTokens(inputStr);
          const isCoord = COORD_TOOLS.has(block.name);

          if (isCoord) {
            tokens.taskCoordination += toks;
          } else {
            tokens.toolOutputs += toks;
          }

          // Register this call so its result can be attributed back
          toolCallMap.set(block.id, { name: block.name, tokens: toks, isCoord });
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
            const toks = estimateTokens(resultText);

            // Look up the originating tool_use by id to determine name and category
            const callEntry = toolCallMap.get(block.tool_use_id);
            if (callEntry) {
              callEntry.tokens += toks;
              if (callEntry.isCoord) {
                tokens.taskCoordination += toks;
              } else {
                tokens.toolOutputs += toks;
              }
            } else {
              // Orphaned result — no matching tool_use found
              tokens.toolOutputs += toks;
              toolCallMap.set(block.tool_use_id, { name: 'unknown', tokens: toks, isCoord: false });
            }
          }
        }
      }
    }
  }

  // Convert per-call entries into breakdown arrays — one entry per individual call
  for (const [, entry] of toolCallMap) {
    if (entry.isCoord) {
      breakdowns.taskCoordinationItems.push({ label: entry.name, tokens: entry.tokens });
    } else {
      breakdowns.toolOutputItems.push({ toolName: entry.name, tokenCount: entry.tokens });
    }
  }

  return { tokens, breakdowns };
}

/**
 * Attribute user chunk content to token categories independently.
 *
 * Each category is tracked separately — a single user message can contribute
 * to claudeMd, mentionedFiles, AND userMessages simultaneously. This matches
 * devtools behaviour where content is scanned for each category independently.
 */
function attributeUserChunk(chunk: UserChunk): { tokens: TokensByCategory; breakdowns: TurnBreakdowns } {
  const tokens = emptyCategory();
  const breakdowns = emptyBreakdowns();
  const msg = chunk.message;

  if (typeof msg.content === 'string') {
    const content = msg.content;
    if (content.length === 0) return { tokens, breakdowns };

    let claudeMdTokens = 0;
    let mentionedFileTokens = 0;

    // 1. Extract CLAUDE.md content: "Contents of <path>CLAUDE.md" blocks and <system-reminder> blocks
    const hasClaudeMdContent =
      (content.includes('Contents of') && content.includes('CLAUDE.md')) ||
      content.includes('<system-reminder>');

    if (hasClaudeMdContent) {
      const pathMatches = content.match(/Contents of ([^\s:]+CLAUDE\.md)/g);
      const sysReminderRegex = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
      const sysReminderMatches = content.match(sysReminderRegex);

      const claudeMdSections: string[] = [];

      if (pathMatches && pathMatches.length > 0) {
        for (const match of pathMatches) {
          const headerIdx = content.indexOf(match);
          if (headerIdx >= 0) {
            const afterHeader = headerIdx + match.length;
            const nextContentsIdx = content.indexOf('Contents of', afterHeader);
            const sectionEnd = nextContentsIdx >= 0 ? nextContentsIdx : content.length;
            const section = content.slice(headerIdx, sectionEnd);
            claudeMdSections.push(section);

            const sectionTokens = estimateTokens(section);
            const path = match.replace('Contents of ', '');
            breakdowns.claudeMdItems.push({ label: path, tokens: sectionTokens });
            claudeMdTokens += sectionTokens;
          }
        }
      }

      if (sysReminderMatches) {
        for (const block of sysReminderMatches) {
          const alreadyCovered = claudeMdSections.some(section => section.includes(block));
          if (!alreadyCovered) {
            const blockTokens = estimateTokens(block);
            breakdowns.claudeMdItems.push({ label: 'system-reminder', tokens: blockTokens });
            claudeMdTokens += blockTokens;
          }
        }
      }

      if (claudeMdTokens === 0) {
        claudeMdTokens = estimateTokens(content);
        breakdowns.claudeMdItems.push({ label: 'system-reminder', tokens: claudeMdTokens });
      }

      tokens.claudeMd += claudeMdTokens;
    }

    // 2. Extract @-mentioned file content (independently — does not subtract claudeMd).
    // Note: the /@[\w./\\-]+/ regex may false-positive on email addresses,
    // but this is acceptable for rough token estimation purposes.
    if (content.includes('@') && content.match(/@[\w./\\-]+/)) {
      const fileMatches = content.match(/@[\w./\\-]+/g);
      if (fileMatches) {
        const totalTokenCount = estimateTokens(content);
        const perFileTokens = Math.ceil(totalTokenCount / fileMatches.length);
        for (const match of fileMatches) {
          breakdowns.mentionedFileItems.push({ label: match.slice(1), tokens: perFileTokens });
        }
        mentionedFileTokens = perFileTokens * fileMatches.length;
        tokens.mentionedFiles += mentionedFileTokens;
      }
    }

    // 3. User message: remaining text after subtracting precisely-extracted content.
    //    Only CLAUDE.md/system-reminder sections are subtracted (since they were precisely
    //    extracted from the raw text). File reference tokens are estimated independently
    //    and may overlap with user message tokens — this is intentional and matches
    //    devtools where categories are tracked independently and can overlap.
    const totalTokenCount = estimateTokens(content);
    const userMessageTokens = Math.max(0, totalTokenCount - claudeMdTokens);
    if (userMessageTokens > 0) {
      tokens.userMessages += userMessageTokens;
      const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
      breakdowns.userMessageItems.push({ label: preview, tokens: userMessageTokens });
    }
  }

  return { tokens, breakdowns };
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
