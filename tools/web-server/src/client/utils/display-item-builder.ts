import type { SemanticStep, ParsedMessage, Process } from '../types/session.js';
import type {
  AIGroupLastOutput, AIGroupDisplayItem, LinkedToolItemData,
  SlashItem, TeammateMessage, CompactionTokenDelta,
} from '../types/groups.js';
import { linkToolCallsToResults, estimateTokens } from './tool-linking-engine.js';
import { extractTextContent, toDate } from './display-helpers.js';

/**
 * Extract text from message content that may be a string or ContentBlock array.
 */
function extractMsgText(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

/**
 * Build display items for a main session AI group.
 * Skips the lastOutput step (rendered separately), skips Task calls that have subagents.
 *
 * @param precedingSlash - Optional slash command from the preceding user group,
 *   passed through to extractSlashCommands() for Strategy 1 matching.
 */
export function buildDisplayItems(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
  processes: Process[],
  messages: ParsedMessage[],
  precedingSlash?: SlashItem,
  now?: Date,
): { items: AIGroupDisplayItem[]; linkedTools: Map<string, LinkedToolItemData> } {
  const linkedTools = linkToolCallsToResults(steps, messages);
  const timestamp = now ?? new Date();

  // Set of Task tool IDs that have associated subagents (don't show as tool items)
  const taskIdsWithSubagents = new Set<string>();
  for (const p of processes) {
    if (p.parentTaskId) taskIdsWithSubagents.add(p.parentTaskId);
  }

  // Find the index of the step that produced lastOutput (to skip it in display)
  const lastOutputStepIndex = findLastOutputStepIndex(steps, lastOutput);

  const items: AIGroupDisplayItem[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Skip the step that produced lastOutput
    if (i === lastOutputStepIndex) continue;

    switch (step.type) {
      case 'thinking':
        items.push({
          type: 'thinking',
          content: step.content,
          timestamp: timestamp,
          tokenCount: estimateTokens(step.content),
        });
        break;

      case 'tool_call': {
        const tool = linkedTools.get(step.toolCallId ?? '');
        if (!tool) break;
        // Skip Task calls that have subagents
        if (tool.name === 'Task' && taskIdsWithSubagents.has(tool.id)) break;
        items.push({ type: 'tool', tool });
        break;
      }

      case 'tool_result':
        // Rendered as part of linked tool items
        break;

      case 'subagent': {
        // step.subagentId is the tool_use block ID (from the Task tool call),
        // while process.id is the agent ID from the filename. The link between
        // them is process.parentTaskId which matches the tool call ID.
        const process = processes.find(
          (p) => p.id === step.subagentId || p.parentTaskId === step.subagentId,
        );
        if (process) {
          items.push({ type: 'subagent', subagent: process });
        }
        break;
      }

      case 'output':
        items.push({
          type: 'output',
          content: step.content,
          timestamp: timestamp,
          tokenCount: estimateTokens(step.content),
        });
        break;

    }
  }

  // Extract teammate messages from responses
  const teammateMessages = extractTeammateMessages(messages);
  for (const tm of teammateMessages) {
    items.push({ type: 'teammate_message', teammateMessage: tm });
  }

  // Extract slash commands from responses (uses precedingSlash for Strategy 1)
  const slashes = extractSlashCommands(messages, precedingSlash);
  for (const slash of slashes) {
    items.push({ type: 'slash', slash });
  }

  return { items, linkedTools };
}

/**
 * Build display items from messages for subagent traces.
 * Two-pass builder: first collects data, then links and builds items.
 */
export function buildDisplayItemsFromMessages(
  messages: ParsedMessage[],
  subagents?: Process[],
): AIGroupDisplayItem[] {
  const items: AIGroupDisplayItem[] = [];
  const toolUseMap = new Map<string, { name: string; input: Record<string, unknown>; startTime: Date }>();
  const toolResultMap = new Map<string, { content: string | unknown[]; isError: boolean; endTime: Date }>();
  const skillInstructionsMap = new Map<string, { text: string; tokenCount: number }>();
  const processes = subagents ?? [];

  // Set of Task tool IDs that have associated subagents
  const taskIdsWithSubagents = new Set<string>();
  for (const p of processes) {
    if (p.parentTaskId) taskIdsWithSubagents.add(p.parentTaskId);
  }

  // Pass 1: Walk messages chronologically, collect data
  for (const msg of messages) {
    // Compact boundary entries
    if (msg.isCompactSummary && typeof msg.content === 'string') {
      items.push({
        type: 'compact_boundary',
        content: msg.content,
        timestamp: msg.timestamp,
        phaseNumber: 0, // Assigned in post-pass
      });
      continue;
    }

    // Skill instructions from isMeta messages
    if (msg.isMeta && msg.sourceToolUseID) {
      const textContent = extractMsgText(msg.content);
      if (textContent.startsWith('Base directory for this skill:')) {
        skillInstructionsMap.set(msg.sourceToolUseID, {
          text: textContent,
          tokenCount: estimateTokens(textContent),
        });
      }
    }

    // Teammate messages from user messages
    if (msg.type === 'user' && !msg.isMeta && typeof msg.content === 'string') {
      const teammateMsgs = parseTeammateMessageBlocks(msg.content, msg.timestamp);
      for (const tm of teammateMsgs) {
        items.push({ type: 'teammate_message', teammateMessage: tm });
      }
    }

    // Subagent input: non-meta user messages with text content and no tool results
    if (msg.type === 'user' && !msg.isMeta && msg.toolResults.length === 0) {
      const textContent = extractTextContent(msg.content);
      if (textContent) {
        items.push({
          type: 'subagent_input',
          content: textContent,
          timestamp: msg.timestamp,
          tokenCount: estimateTokens(textContent),
        });
      }
    }

    // Tool results from isMeta user messages
    if (msg.type === 'user' && msg.isMeta) {
      for (const tr of msg.toolResults) {
        toolResultMap.set(tr.toolUseId, {
          content: tr.content,
          isError: tr.isError,
          endTime: msg.timestamp,
        });
      }
    }

    // Assistant message content blocks
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'thinking' && 'thinking' in block) {
          items.push({
            type: 'thinking',
            content: block.thinking,
            timestamp: msg.timestamp,
            tokenCount: estimateTokens(block.thinking),
          });
        } else if (block.type === 'tool_use' && 'id' in block) {
          toolUseMap.set(block.id, {
            name: block.name,
            input: block.input,
            startTime: msg.timestamp,
          });
        } else if (block.type === 'text' && 'text' in block && block.text.trim()) {
          items.push({
            type: 'output',
            content: block.text,
            timestamp: msg.timestamp,
            tokenCount: estimateTokens(block.text),
          });
        }
      }
    }

    // Collect tool calls from message
    for (const tc of msg.toolCalls) {
      toolUseMap.set(tc.id, {
        name: tc.name,
        input: tc.input,
        startTime: msg.timestamp,
      });
    }

    // Collect tool results from non-meta messages too
    if (!msg.isMeta) {
      for (const tr of msg.toolResults) {
        toolResultMap.set(tr.toolUseId, {
          content: tr.content,
          isError: tr.isError,
          endTime: msg.timestamp,
        });
      }
    }
  }

  // Pass 2: Build LinkedToolItems by matching tool_use to tool_result
  for (const [toolCallId, toolUse] of toolUseMap) {
    // Skip Task calls with associated subagents
    if (toolUse.name === 'Task' && taskIdsWithSubagents.has(toolCallId)) continue;

    const resultData = toolResultMap.get(toolCallId);
    const skillInfo = skillInstructionsMap.get(toolCallId);
    const callTokens = estimateTokens(toolUse.name + JSON.stringify(toolUse.input));

    const linked: LinkedToolItemData = {
      id: toolCallId,
      name: toolUse.name,
      input: toolUse.input,
      callTokens,
      result: resultData ? {
        content: resultData.content,
        isError: resultData.isError,
        tokenCount: estimateTokens(
          typeof resultData.content === 'string'
            ? resultData.content
            : JSON.stringify(resultData.content),
        ),
      } : undefined,
      inputPreview: JSON.stringify(toolUse.input).slice(0, 100),
      outputPreview: resultData
        ? String(resultData.content).slice(0, 200)
        : undefined,
      startTime: toolUse.startTime,
      endTime: resultData?.endTime,
      isOrphaned: !resultData,
      skillInstructions: skillInfo?.text,
      skillInstructionsTokenCount: skillInfo?.tokenCount,
    };

    if (resultData?.endTime) {
      linked.durationMs = toDate(resultData.endTime).getTime() - toDate(toolUse.startTime).getTime();
    }

    items.push({ type: 'tool', tool: linked });
  }

  // Add subagent display items
  for (const proc of processes) {
    items.push({ type: 'subagent', subagent: proc });
  }

  // Assign phase numbers to compact boundaries
  let phaseNum = 1;
  for (const item of items) {
    if (item.type === 'compact_boundary') {
      item.phaseNumber = phaseNum++;
    }
  }

  // Sort chronologically by timestamp
  items.sort((a, b) => {
    const tsA = getDisplayItemTimestamp(a);
    const tsB = getDisplayItemTimestamp(b);
    return tsA.getTime() - tsB.getTime();
  });

  return items;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getDisplayItemTimestamp(item: AIGroupDisplayItem): Date {
  switch (item.type) {
    case 'thinking':
    case 'output':
    case 'subagent_input':
    case 'compact_boundary':
      return toDate(item.timestamp);
    case 'tool':
      return toDate(item.tool.startTime);
    case 'subagent':
      return toDate(item.subagent.startTime ?? new Date(0));
    case 'slash':
      return toDate(item.slash.timestamp);
    case 'teammate_message':
      return toDate(item.teammateMessage.timestamp);
  }
}

/**
 * Find the index of the step that produced lastOutput, to skip it in display.
 * Returns -1 if no match found.
 */
function findLastOutputStepIndex(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
): number {
  if (!lastOutput) return -1;

  if (lastOutput.type === 'tool_result') {
    // Find last tool_result step
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'tool_result') return i;
    }
  }

  if (lastOutput.type === 'plan_exit') {
    // Find last ExitPlanMode tool_call
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'tool_call' && steps[i].toolName === 'ExitPlanMode') return i;
    }
  }

  if (lastOutput.type === 'text') {
    // Find the last output step matching the text
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'output' && steps[i].content === lastOutput.text) return i;
    }
  }

  return -1;
}

/**
 * Extract teammate messages from `<teammate-message>` XML blocks in user messages.
 */
export function extractTeammateMessages(messages: ParsedMessage[]): TeammateMessage[] {
  const results: TeammateMessage[] = [];

  for (const msg of messages) {
    if (msg.type !== 'user' || msg.isMeta) continue;
    const text = extractTextContent(msg.content);
    if (!text) continue;

    const parsed = parseTeammateMessageBlocks(text, msg.timestamp);
    results.push(...parsed);
  }

  return results;
}

function parseTeammateMessageBlocks(text: string, timestamp: Date): TeammateMessage[] {
  const results: TeammateMessage[] = [];
  // Note: regex assumes type= appears before name= in teammate message format.
  // If the format changes, this will need to be updated.
  const regex = /<teammate-message(?:\s+teammate-id="([^"]*)")?(?:\s+color="([^"]*)")?(?:\s+summary="([^"]*)")?>([\s\S]*?)<\/teammate-message>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    results.push({
      teammateId: match[1] || 'unknown',
      color: match[2] || undefined,
      summary: match[3] || undefined,
      content: match[4].trim(),
      timestamp,
    });
  }

  return results;
}

/**
 * Extract slash commands from responses.
 *
 * Strategy 1: If precedingSlash is provided, use it directly.
 *   Find follow-up isMeta messages with instructions.
 *
 * Strategy 2: Scan responses for messages with `<command-name>` XML blocks.
 */
export function extractSlashCommands(
  messages: ParsedMessage[],
  precedingSlash?: SlashItem,
): SlashItem[] {
  const results: SlashItem[] = [];

  if (precedingSlash) {
    // Strategy 1: Use provided precedingSlash directly
    // Look for follow-up isMeta messages that provide instructions
    const slash = { ...precedingSlash };
    for (const msg of messages) {
      if (msg.isMeta) {
        const textContent = extractMsgText(msg.content);
        if (textContent.startsWith('Base directory')) {
          slash.instructions = textContent;
          slash.instructionsTokenCount = estimateTokens(textContent);
          break;
        }
      }
    }
    results.push(slash);
    return results;
  }

  // Strategy 2: Scan responses for command-name XML blocks
  for (const msg of messages) {
    if (msg.type !== 'user' || msg.isMeta) continue;
    const text = extractTextContent(msg.content);
    if (!text) continue;

    const cmdRegex = /<command-name>\/?([\w-]+)<\/command-name>/g;
    let match: RegExpExecArray | null;
    while ((match = cmdRegex.exec(text)) !== null) {
      const slash: SlashItem = {
        id: `slash-${msg.uuid}`,
        name: match[1],
        commandMessageUuid: msg.uuid,
        timestamp: msg.timestamp,
      };

      // Look for isMeta messages with instructions for this slash
      for (const followUp of messages) {
        if (followUp.isMeta && followUp.sourceToolUseID) {
          const textContent = extractMsgText(followUp.content);
          if (textContent.startsWith('Base directory')) {
            slash.instructions = textContent;
            slash.instructionsTokenCount = estimateTokens(textContent);
            break;
          }
        }
      }

      results.push(slash);
    }
  }

  return results;
}
