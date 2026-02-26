import { Bot } from 'lucide-react';
import { formatTimestamp, formatTokenCount } from '../../utils/session-formatters.js';
import { TextItem } from './items/TextItem.js';
import { ThinkingItem } from './items/ThinkingItem.js';
import { LinkedToolItem } from './items/LinkedToolItem.js';
import { SubagentItem } from './items/SubagentItem.js';
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
}

function isEnhanced(chunk: AIChunkType): chunk is EnhancedAIChunkType {
  return 'semanticSteps' in chunk;
}

export function AIChunk({ chunk }: Props) {
  const { messages, timestamp } = chunk;
  const enhanced = isEnhanced(chunk);

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
              ? endTime.getTime() - startTime.getTime()
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

  // Non-enhanced fallback: render raw text from messages
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

  // Enhanced: render semantic steps
  return (
    <div className="flex gap-2 mb-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
        <Bot className="w-4 h-4 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        {chunk.semanticSteps.map((step, i) => (
          <AIStepRenderer key={i} step={step} toolExecMap={toolExecutions} subagents={chunk.subagents} />
        ))}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
          {model && <span>{model}</span>}
          {totalTokens > 0 && <span>{formatTokenCount(totalTokens)} tokens</span>}
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function AIStepRenderer({
  step,
  toolExecMap,
  subagents,
}: {
  step: SemanticStep;
  toolExecMap: Map<string, ToolExecution>;
  subagents: Process[];
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

    case 'interruption':
      return (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 my-1">
          {step.content || 'Interrupted'}
        </div>
      );

    default:
      return step.content ? <TextItem content={step.content} /> : null;
  }
}
