import { Bot, ChevronRight } from 'lucide-react';
import { formatTimestamp, formatTokenCount, formatDuration } from '../../utils/session-formatters.js';
import { findLastOutput } from '../../utils/last-output-detector.js';
import { TextItem } from './items/TextItem.js';
import { ThinkingItem } from './items/ThinkingItem.js';
import { LinkedToolItem } from './items/LinkedToolItem.js';
import { SubagentItem } from './items/SubagentItem.js';
import { LastOutputDisplay } from './LastOutputDisplay.js';
import { useSessionViewStore } from '../../store/session-store.js';
import type {
  EnhancedAIChunk as EnhancedAIChunkType,
  AIChunk as AIChunkType,
  SemanticStep,
  ToolExecution,
  Process,
  TextContent,
} from '../../types/session.js';

interface Props {
  chunk: AIChunkType;
  chunkIndex: number;
}

function isEnhanced(chunk: AIChunkType): chunk is EnhancedAIChunkType {
  return 'semanticSteps' in chunk;
}

/**
 * Build a short summary string from semantic steps, e.g. "2 tools, 1 thinking, 1 output"
 */
function buildStepSummary(steps: SemanticStep[]): string {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    // Skip tool_result since they are displayed as part of tool_call
    if (step.type === 'tool_result') continue;
    counts[step.type] = (counts[step.type] || 0) + 1;
  }

  const labels: Record<string, string> = {
    tool_call: 'tool',
    thinking: 'thinking',
    output: 'output',
    subagent: 'subagent',
  };

  const parts: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    const label = labels[type] || type;
    parts.push(`${count} ${label}${count !== 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}

export function AIChunk({ chunk, chunkIndex }: Props) {
  const { messages, timestamp } = chunk;
  const enhanced = isEnhanced(chunk);
  const { expandedGroups, toggleGroup } = useSessionViewStore();
  const isExpanded = expandedGroups.has(String(chunkIndex));

  // Build tool execution lookup from chunk messages
  const toolExecutions = new Map<string, ToolExecution>();
  if (enhanced) {
    for (const msg of messages) {
      for (const tc of msg.toolCalls) {
        const resultMsg = messages.find((m) =>
          m.toolResults.some((r) => r.toolUseId === tc.id),
        );
        const matchingResult = resultMsg?.toolResults.find(
          (r) => r.toolUseId === tc.id,
        );
        const startTime = msg.timestamp;
        const endTime = resultMsg?.timestamp;
        toolExecutions.set(tc.id, {
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.input,
          result: matchingResult,
          startTime,
          endTime,
          durationMs:
            endTime && startTime
              ? new Date(endTime).getTime() - new Date(startTime).getTime()
              : undefined,
          isOrphaned: !matchingResult,
        });
      }
    }
  }

  // Aggregate metrics
  const totalTokens = messages.reduce((sum, m) => {
    if (m.usage) {
      return sum + (m.usage.input_tokens || 0) + (m.usage.output_tokens || 0);
    }
    return sum;
  }, 0);
  const model = messages.find((m) => m.model)?.model;

  // Compute duration from first to last message timestamp
  const duration =
    messages.length >= 2
      ? new Date(messages[messages.length - 1].timestamp).getTime() -
        new Date(messages[0].timestamp).getTime()
      : undefined;

  // Non-enhanced fallback: render raw text from messages (NOT collapsible)
  if (!enhanced) {
    return (
      <div className="flex gap-2 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          {messages.map((msg, i) => {
            const text =
              typeof msg.content === 'string'
                ? msg.content
                : msg.content
                    .filter((b): b is TextContent => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n');
            return text ? <TextItem key={i} content={text} /> : null;
          })}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            {model && <span>{model}</span>}
            {totalTokens > 0 && <span>{formatTokenCount(totalTokens)} tokens</span>}
            <span>{formatTimestamp(timestamp)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Enhanced: render semantic steps with collapse/expand
  const lastOutput = findLastOutput(chunk.semanticSteps);
  const stepSummary = buildStepSummary(chunk.semanticSteps);

  return (
    <div className="mb-4">
      {/* Clickable header bar */}
      <button
        type="button"
        onClick={() => toggleGroup(String(chunkIndex))}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        {/* Left side: bot icon, model badge, step summary */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {model && (
            <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 flex-shrink-0">
              {model}
            </span>
          )}
          <span className="text-xs text-slate-400 truncate">
            {stepSummary}
          </span>
        </div>

        {/* Right side: context badge, tokens, duration, chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {totalTokens > 0 && (
            <span className="text-xs text-slate-400">{formatTokenCount(totalTokens)}</span>
          )}
          {duration != null && duration > 0 && (
            <span className="text-xs text-slate-400">{formatDuration(duration)}</span>
          )}
          <ChevronRight
            className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {/* Expanded: all semantic steps */}
      {isExpanded && (
        <div className="pl-10 mt-1">
          {chunk.semanticSteps.map((step, i) => (
            <AIStepRenderer key={i} step={step} toolExecMap={toolExecutions} subagents={chunk.subagents} />
          ))}
        </div>
      )}

      {/* LastOutputDisplay always visible */}
      <div className="pl-10">
        <LastOutputDisplay lastOutput={lastOutput} />
      </div>
    </div>
  );
}

function AIStepRenderer({
  step,
  toolExecMap,
  subagents = [],
}: {
  step: SemanticStep;
  toolExecMap: Map<string, ToolExecution>;
  subagents?: Process[];
}) {
  switch (step.type) {
    case 'thinking':
      return <ThinkingItem content={step.content} tokenCount={Math.ceil(step.content.length / 4)} />;

    case 'output':
      return <TextItem content={step.content} />;

    case 'tool_call': {
      const exec = step.toolCallId ? toolExecMap.get(step.toolCallId) : undefined;
      if (exec) {
        return <LinkedToolItem execution={exec} />;
      }
      return (
        <div className="text-xs text-slate-400 italic my-1">
          Tool call: {step.toolName || 'unknown'}
          {step.content ? ` — ${step.content}` : ''}
        </div>
      );
    }

    case 'tool_result':
      // Displayed as part of LinkedToolItem
      return null;

    case 'subagent': {
      const matchedProcess = step.subagentId
        ? subagents.find((p) => p.id === step.subagentId)
        : undefined;
      if (matchedProcess) {
        return <SubagentItem process={matchedProcess} />;
      }
      return (
        <div className="text-xs text-slate-400 italic my-1 border border-slate-200 rounded px-2 py-1">
          Subagent: {step.subagentId || 'unknown'}
        </div>
      );
    }

    default:
      return step.content ? <TextItem content={step.content} /> : null;
  }
}
