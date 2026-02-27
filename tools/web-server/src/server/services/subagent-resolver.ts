import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { ParsedMessage, Process, SessionMetrics } from '../types/jsonl.js';
import { parseSessionFile } from './session-parser.js';

const PARALLEL_THRESHOLD_MS = 100;

export interface SubagentResolverOptions {
  projectDir: string;
  sessionId: string;
}

export async function resolveSubagents(
  parentMessages: ParsedMessage[],
  options: SubagentResolverOptions,
): Promise<Process[]> {
  // 1. Discover subagent files from both directory structures
  const files = await discoverSubagentFiles(options.projectDir, options.sessionId);
  if (files.length === 0) return [];

  // 2. Parse each subagent file and filter out warmup/compact/empty
  const agents: { agentId: string; filePath: string; messages: ParsedMessage[] }[] = [];
  for (const file of files) {
    const { messages } = await parseSessionFile(file.filePath);
    if (isFilteredAgent(messages, file.agentId)) continue;
    agents.push({ ...file, messages });
  }

  if (agents.length === 0) return [];

  // 3. Collect Task tool calls from parent messages
  const taskCalls: { callId: string; description?: string; subagentType?: string; timestamp: Date }[] =
    [];
  for (const msg of parentMessages) {
    for (const call of msg.toolCalls) {
      if (call.isTask) {
        taskCalls.push({
          callId: call.id,
          description: call.taskDescription,
          subagentType: call.taskSubagentType,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  // 4. Collect result-based links: toolUseResult.agentId on parent tool result messages
  // The tool_use_id linking back to the Task tool_use block is in the tool_result
  // content block (msg.toolResults[0]?.toolUseId), NOT in msg.sourceToolUseID which
  // is not set on tool_result messages.
  const resultLinks = new Map<string, string>(); // agentId -> taskCallId
  for (const msg of parentMessages) {
    if (msg.toolUseResult) {
      const agentId = msg.toolUseResult.agentId;
      const toolUseId = msg.toolResults?.[0]?.toolUseId;
      if (typeof agentId === 'string' && toolUseId) {
        resultLinks.set(agentId, toolUseId);
      }
    }
  }

  // 5. Three-phase linking
  const processes: Process[] = [];
  const matchedAgentIds = new Set<string>();
  const matchedTaskIds = new Set<string>();

  // Phase A: Result-based matching
  for (const agent of agents) {
    const taskCallId = resultLinks.get(agent.agentId);
    if (taskCallId && !matchedTaskIds.has(taskCallId)) {
      const taskCall = taskCalls.find((t) => t.callId === taskCallId);
      matchedAgentIds.add(agent.agentId);
      matchedTaskIds.add(taskCallId);
      processes.push(
        buildProcess(agent, {
          parentTaskId: taskCallId,
          description: taskCall?.description,
          subagentType: taskCall?.subagentType,
        }),
      );
    }
  }

  // Phase B: Description-based matching (match Task description to <teammate-message summary="...">)
  const unmatchedAgents = agents.filter((a) => !matchedAgentIds.has(a.agentId));
  const unmatchedTasks = taskCalls.filter((t) => !matchedTaskIds.has(t.callId));

  for (const agent of unmatchedAgents) {
    if (matchedAgentIds.has(agent.agentId)) continue;
    // Check first user message for <teammate-message summary="...">
    const firstUserMsg = agent.messages.find(
      (m) => m.type === 'user' && typeof m.content === 'string',
    );
    if (!firstUserMsg || typeof firstUserMsg.content !== 'string') continue;

    const summaryMatch = firstUserMsg.content.match(/summary="([^"]+)"/);
    if (!summaryMatch) continue;
    const summary = summaryMatch[1];

    for (const task of unmatchedTasks) {
      if (matchedTaskIds.has(task.callId)) continue;
      if (task.description && summary.includes(task.description)) {
        matchedAgentIds.add(agent.agentId);
        matchedTaskIds.add(task.callId);
        processes.push(
          buildProcess(agent, {
            parentTaskId: task.callId,
            description: task.description,
            subagentType: task.subagentType,
          }),
        );
        break;
      }
    }
  }

  // Phase C: Positional fallback -- match remaining by chronological order
  const stillUnmatchedAgents = agents.filter((a) => !matchedAgentIds.has(a.agentId));
  const stillUnmatchedTasks = unmatchedTasks.filter((t) => !matchedTaskIds.has(t.callId));

  // Sort both by timestamp
  stillUnmatchedAgents.sort((a, b) => {
    const aTime = a.messages[0]?.timestamp?.getTime() ?? 0;
    const bTime = b.messages[0]?.timestamp?.getTime() ?? 0;
    return aTime - bTime;
  });
  stillUnmatchedTasks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (let i = 0; i < stillUnmatchedAgents.length; i++) {
    const agent = stillUnmatchedAgents[i];
    const task = stillUnmatchedTasks[i]; // May be undefined if more agents than tasks
    processes.push(
      buildProcess(agent, {
        parentTaskId: task?.callId,
        description: task?.description,
        subagentType: task?.subagentType,
      }),
    );
  }

  // 6. Detect parallel subagents (start times within PARALLEL_THRESHOLD_MS)
  for (let i = 0; i < processes.length; i++) {
    for (let j = i + 1; j < processes.length; j++) {
      const diff = Math.abs(processes[i].startTime.getTime() - processes[j].startTime.getTime());
      if (diff <= PARALLEL_THRESHOLD_MS) {
        processes[i].isParallel = true;
        processes[j].isParallel = true;
      }
    }
  }

  // Sort by start time
  processes.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return processes;
}

async function belongsToSession(filePath: string, sessionId: string): Promise<boolean> {
  try {
    // Read just the first line to check sessionId
    const content = await readFile(filePath, 'utf8');
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

    if (!firstLine.trim()) {
      return false;
    }

    const entry = JSON.parse(firstLine) as { sessionId?: string };
    return entry.sessionId === sessionId;
  } catch {
    // If we can't read or parse the file, don't include it
    return false;
  }
}

async function discoverSubagentFiles(
  projectDir: string,
  sessionId: string,
): Promise<{ agentId: string; filePath: string }[]> {
  const results: { agentId: string; filePath: string }[] = [];

  // New structure: {projectDir}/{sessionId}/subagents/agent-*.jsonl
  const newDir = join(projectDir, sessionId, 'subagents');
  try {
    const entries = await readdir(newDir);
    for (const entry of entries) {
      const match = entry.match(/^agent-(.+)\.jsonl$/);
      if (match) {
        results.push({ agentId: match[1], filePath: join(newDir, entry) });
      }
    }
  } catch {
    // Directory doesn't exist -- that's fine
  }

  // Legacy structure: {projectDir}/agent-*.jsonl
  try {
    const entries = await readdir(projectDir);
    for (const entry of entries) {
      const match = entry.match(/^agent-(.+)\.jsonl$/);
      if (match) {
        const filePath = join(projectDir, entry);
        // Avoid duplicates if already found in new structure
        if (!results.some((r) => r.agentId === match[1])) {
          // Filter by sessionId - only include files that belong to this session
          const belongsToThisSession = await belongsToSession(filePath, sessionId);
          if (belongsToThisSession) {
            results.push({ agentId: match[1], filePath });
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

function isFilteredAgent(messages: ParsedMessage[], agentId: string): boolean {
  // Empty files
  if (messages.length === 0) return true;
  // Warmup agents: first message content is "Warmup"
  const first = messages[0];
  if (typeof first.content === 'string' && first.content.trim() === 'Warmup') return true;
  // Compact files (agentId starts with 'acompact')
  if (agentId.startsWith('acompact')) return true;
  return false;
}

function buildProcess(
  agent: { agentId: string; filePath: string; messages: ParsedMessage[] },
  link: { parentTaskId?: string; description?: string; subagentType?: string },
): Process {
  const startTime = agent.messages[0]?.timestamp ?? new Date();
  const endTime = agent.messages[agent.messages.length - 1]?.timestamp ?? startTime;
  const durationMs = endTime.getTime() - startTime.getTime();

  return {
    id: agent.agentId,
    filePath: agent.filePath,
    messages: agent.messages,
    startTime,
    endTime,
    durationMs,
    metrics: calculateAgentMetrics(agent.messages),
    description: link.description,
    subagentType: link.subagentType,
    isParallel: false, // Will be updated in parallel detection pass
    parentTaskId: link.parentTaskId,
    isOngoing: detectOngoing(agent.messages),
  };
}

function calculateAgentMetrics(messages: ParsedMessage[]): SessionMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let toolCallCount = 0;
  let turnCount = 0;

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.usage) {
      inputTokens += msg.usage.input_tokens ?? 0;
      outputTokens += msg.usage.output_tokens ?? 0;
      cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
      cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
      turnCount++;
    }
    toolCallCount += msg.toolCalls.length;
  }

  const startTime = messages[0]?.timestamp?.getTime() ?? 0;
  const endTime = messages[messages.length - 1]?.timestamp?.getTime() ?? 0;

  return {
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalCost: 0, // Will be calculated by PricingEngine
    turnCount,
    toolCallCount,
    duration: endTime - startTime,
  };
}

function detectOngoing(messages: ParsedMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  // If last message is assistant with tool_use stop_reason or has thinking without completion
  if (last.type === 'assistant' && Array.isArray(last.content)) {
    const hasToolUse = last.content.some((b) => b.type === 'tool_use');
    const hasThinking = last.content.some((b) => b.type === 'thinking');
    // If there's an unresolved tool call or thinking, it's ongoing
    if (hasToolUse || hasThinking) {
      // If the LAST message has tool_use, no result followed
      return true;
    }
  }
  return false;
}

