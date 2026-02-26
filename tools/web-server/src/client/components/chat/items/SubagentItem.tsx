import { useState, useMemo } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  Loader2,
  Search,
  FileCode,
  LayoutList,
  Bot,
  Clock,
  Cpu,
  MessageSquare,
  Wrench,
  RotateCw,
} from 'lucide-react';
import { MetricsPill } from '../MetricsPill.js';
import { formatDuration, formatTokenCount } from '../../../utils/session-formatters.js';
import { TextItem } from './TextItem.js';
import { ThinkingItem } from './ThinkingItem.js';
import { LinkedToolItem } from './LinkedToolItem.js';
import type {
  Process,
  ToolExecution,
  ToolResult,
  ParsedMessage,
  ContentBlock,
  TextContent,
  ThinkingContent,
} from '../../../types/session.js';

interface Props {
  process: Process;
  depth?: number;
}

const typeIcons: Record<string, typeof Bot> = {
  Explore: Search,
  Plan: LayoutList,
  'general-purpose': FileCode,
};

const typeColors: Record<string, string> = {
  Explore: 'text-blue-600 bg-blue-100',
  Plan: 'text-purple-600 bg-purple-100',
  'general-purpose': 'text-green-600 bg-green-100',
};

const defaultTypeColor = 'text-slate-600 bg-slate-100';

/** Build ToolExecution objects by matching tool_use calls with their results. */
function buildToolExecutions(messages: ParsedMessage[]): ToolExecution[] {
  const resultMap = new Map<string, ToolResult>();

  // Collect all tool results first
  for (const msg of messages) {
    for (const tr of msg.toolResults) {
      resultMap.set(tr.toolUseId, tr);
    }
  }

  const executions: ToolExecution[] = [];
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const result = resultMap.get(tc.id);
      executions.push({
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.input,
        result,
        startTime: msg.timestamp,
        endTime: undefined,
        durationMs: undefined,
        isOrphaned: !result,
      });
    }
  }

  return executions;
}

/** Extract text blocks from content array. */
function getTextBlocks(content: ContentBlock[] | string): string[] {
  if (typeof content === 'string') return content ? [content] : [];
  return content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .filter(Boolean);
}

/** Extract thinking blocks from content array. */
function getThinkingBlocks(content: ContentBlock[] | string): string[] {
  if (typeof content === 'string') return [];
  return content
    .filter((b): b is ThinkingContent => b.type === 'thinking')
    .map((b) => b.thinking)
    .filter(Boolean);
}

/** Extract short preview from a user message. */
function getUserPreview(msg: ParsedMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content.length > 120 ? msg.content.slice(0, 117) + '\u2026' : msg.content;
  }
  const texts = getTextBlocks(msg.content);
  const joined = texts.join(' ');
  return joined.length > 120 ? joined.slice(0, 117) + '\u2026' : joined;
}

export function SubagentItem({ process, depth = 0 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  const agentType = process.subagentType || 'Task';
  const Icon = typeIcons[agentType] || Bot;
  const colorClasses = typeColors[agentType] || defaultTypeColor;
  const description = process.description || `${agentType} subagent`;

  const toolExecutions = useMemo(
    () => buildToolExecutions(process.messages),
    [process.messages],
  );

  // Split messages for execution trace rendering
  const traceMessages = useMemo(() => {
    return process.messages.filter(
      (m) => m.type === 'user' || m.type === 'assistant',
    );
  }, [process.messages]);

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 ${
        depth > 0 ? 'ml-4 border-slate-200' : 'border-slate-300'
      } bg-white`}
    >
      {/* Level 1: Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClasses}`}
        >
          <Icon className="w-3 h-3" />
          {agentType}
        </span>
        <span className="text-xs text-slate-600 truncate flex-1 text-left">
          {description}
        </span>
        <MetricsPill mainTokens={process.metrics.totalTokens} />
        <span className="text-xs text-slate-400 flex items-center gap-0.5 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {formatDuration(process.durationMs)}
        </span>
        {process.isOngoing ? (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        )}
      </button>

      {/* Level 1 expanded: Meta grid */}
      {expanded && (
        <div className="border-t border-slate-200 px-4 py-3">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs mb-3">
            <div>
              <span className="text-slate-400">Type</span>
              <div className="font-medium text-slate-700">{agentType}</div>
            </div>
            <div>
              <span className="text-slate-400">Duration</span>
              <div className="font-medium text-slate-700">
                {formatDuration(process.durationMs)}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Agent ID</span>
              <div className="font-mono font-medium text-slate-700">
                {process.id.slice(0, 8)}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Tokens</span>
              <div className="font-mono font-medium text-slate-700">
                {formatTokenCount(process.metrics.totalTokens)}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Tool Calls</span>
              <div className="font-medium text-slate-700 flex items-center gap-1">
                <Wrench className="w-3 h-3 text-slate-400" />
                {process.metrics.toolCallCount}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Turns</span>
              <div className="font-medium text-slate-700 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-slate-400" />
                {process.metrics.turnCount}
              </div>
            </div>
          </div>

          {process.isParallel && (
            <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
              <RotateCw className="w-3 h-3" />
              Parallel execution
            </div>
          )}

          {/* Toggle for execution trace */}
          <button
            onClick={() => setShowTrace(!showTrace)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <Cpu className="w-3.5 h-3.5" />
            {showTrace ? 'Hide execution trace' : 'Show execution trace'}
            <ChevronRight
              className={`w-3 h-3 transition-transform ${showTrace ? 'rotate-90' : ''}`}
            />
          </button>

          {/* Level 2: Execution trace */}
          {showTrace && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              {traceMessages.map((msg) => {
                if (msg.type === 'user') {
                  return (
                    <div
                      key={msg.uuid}
                      className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1.5"
                    >
                      <span className="font-medium">User:</span>{' '}
                      {getUserPreview(msg)}
                    </div>
                  );
                }

                // Assistant message: render thinking, text, and tool blocks
                const thinkingBlocks = getThinkingBlocks(msg.content);
                const textBlocks = getTextBlocks(msg.content);
                // Build tool executions scoped to this message
                const msgToolExecs = msg.toolCalls.map((tc) => {
                  const result = msg.toolResults.find(
                    (tr) => tr.toolUseId === tc.id,
                  );
                  // Also check full execution list for results from later messages
                  const fullResult =
                    result || toolExecutions.find((te) => te.toolCallId === tc.id)?.result;
                  return {
                    toolCallId: tc.id,
                    toolName: tc.name,
                    input: tc.input,
                    result: fullResult,
                    startTime: msg.timestamp,
                    endTime: undefined,
                    durationMs: undefined,
                    isOrphaned: !fullResult,
                  } satisfies ToolExecution;
                });

                return (
                  <div key={msg.uuid} className="space-y-1">
                    {thinkingBlocks.map((text, i) => (
                      <ThinkingItem key={`think-${msg.uuid}-${i}`} content={text} />
                    ))}
                    {textBlocks.map((text, i) => (
                      <TextItem key={`text-${msg.uuid}-${i}`} content={text} />
                    ))}
                    {msgToolExecs.map((exec) => (
                      <LinkedToolItem key={exec.toolCallId} execution={exec} />
                    ))}
                    {msg.toolCalls
                      .filter((tc) => tc.isTask)
                      .map((tc) => (
                        <div
                          key={`subtask-${tc.id}`}
                          className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 ml-2 flex items-center gap-1"
                        >
                          <Bot className="w-3 h-3" />
                          Sub-task: {tc.taskSubagentType || 'Task'}{' '}
                          {tc.taskDescription && (
                            <span className="text-slate-400">
                              &mdash; {tc.taskDescription.slice(0, 60)}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                );
              })}
              {traceMessages.length === 0 && (
                <div className="text-xs text-slate-400 italic">
                  No messages in execution trace.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
