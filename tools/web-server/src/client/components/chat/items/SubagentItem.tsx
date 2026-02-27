import { useMemo, useState } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  Loader2,
  Search,
  FileCode,
  LayoutList,
  Bot,
  Clock,
  Terminal,
  ArrowUpRight,
  CircleDot,
  MailOpen,
  Brain,
} from 'lucide-react';
import { MetricsPill } from '../MetricsPill.js';
import {
  formatDuration,
  formatTokenCount,
  formatTokensCompact,
  generateToolSummary,
} from '../../../utils/session-formatters.js';
import { useSessionViewStore } from '../../../store/session-store.js';
import { TextItem } from './TextItem.js';
import { ThinkingItem } from './ThinkingItem.js';
import { LinkedToolItem } from './LinkedToolItem.js';
import { buildDisplayItemsFromMessages } from '../../../utils/display-item-builder.js';
import { buildSummary } from '../../../utils/display-summary.js';
import { parseModelString } from '../../../utils/model-extractor.js';
import type { Process, ParsedMessage, UsageMetadata } from '../../../types/session.js';
import type { AIGroupDisplayItem } from '../../../types/groups.js';

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
  Explore: 'text-blue-600 bg-blue-100 border-blue-200',
  Plan: 'text-purple-600 bg-purple-100 border-purple-200',
  'general-purpose': 'text-green-600 bg-green-100 border-green-200',
};

const defaultTypeColor = 'text-slate-600 bg-slate-100 border-slate-200';

const MODEL_TEXT_COLORS: Record<string, string> = {
  opus: 'text-orange-600',
  sonnet: 'text-blue-600',
  haiku: 'text-emerald-600',
};

/** Extract the model from the first assistant message. */
function extractModel(messages: ParsedMessage[]): ReturnType<typeof parseModelString> {
  const firstAssistant = messages.find(
    (m) => m.type === 'assistant' && m.model && m.model !== '<synthetic>',
  );
  return firstAssistant?.model ? parseModelString(firstAssistant.model) : null;
}

/** Extract the last usage from assistant messages. */
function extractLastUsage(messages: ParsedMessage[]): UsageMetadata | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'assistant' && messages[i].usage) {
      return messages[i].usage!;
    }
  }
  return null;
}

export function SubagentItem({ process, depth = 0 }: Props) {
  console.log('[SSE-DEBUG] SubagentItem render:', {
    processId: process.id,
    numMessages: process.messages?.length ?? 0,
    messagesRef: process.messages === (window as any).__lastSubagentMsgs
      ? 'SAME_REF_AS_LAST'
      : 'different_ref',
    firstMsgContent: typeof process.messages?.[0]?.content === 'string'
      ? process.messages[0].content.substring(0, 50)
      : JSON.stringify(process.messages?.[0]?.content)?.substring(0, 50),
  });
  (window as any).__lastSubagentMsgs = process.messages;

  const expanded = useSessionViewStore((s) => s.expandedSubagents.has(process.id));
  const toggleSubagent = useSessionViewStore((s) => s.toggleSubagent);
  const showTrace = useSessionViewStore((s) => s.expandedSubagentTraces.has(process.id));
  const toggleSubagentTrace = useSessionViewStore((s) => s.toggleSubagentTrace);

  const agentType = process.subagentType || 'Task';
  const Icon = typeIcons[agentType] || Bot;
  const colorClasses = typeColors[agentType] || defaultTypeColor;
  const description = process.description || `${agentType} subagent`;
  const truncatedDesc =
    description.length > 60 ? description.slice(0, 60) + '...' : description;

  // Model info from first assistant message
  const modelInfo = useMemo(() => extractModel(process.messages), [process.messages]);

  // Last usage for subagent context calculation
  const lastUsage = useMemo(() => extractLastUsage(process.messages), [process.messages]);

  // Determine display tokens for the header MetricsPill:
  // Prefer mainSessionImpact (cost to parent), fall back to internal metrics
  const headerTokens = process.mainSessionImpact?.totalTokens ?? process.metrics.totalTokens;

  // Isolated context tokens (the subagent's own context usage)
  const isolatedTotal = lastUsage
    ? lastUsage.input_tokens +
      lastUsage.output_tokens +
      (lastUsage.cache_read_input_tokens ?? 0) +
      (lastUsage.cache_creation_input_tokens ?? 0)
    : 0;

  const hasMainImpact =
    process.mainSessionImpact != null && process.mainSessionImpact.totalTokens > 0;
  const hasIsolated = isolatedTotal > 0;

  // Build display items for execution trace
  const displayItems = useMemo(() => {
    if (!expanded || !process.messages?.length) return [];
    return buildDisplayItemsFromMessages(process.messages, []);
  }, [expanded, process.messages]);

  // Build summary for the trace toggle
  const itemsSummary = useMemo(() => {
    if (!expanded) return '';
    return buildSummary(displayItems);
  }, [expanded, displayItems]);

  // Trace item expansion state
  const [expandedTraceItemId, setExpandedTraceItemId] = useState<string | null>(null);

  const handleTraceItemClick = (itemId: string) => {
    setExpandedTraceItemId((prev) => (prev === itemId ? null : itemId));
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 ${
        depth > 0 ? 'ml-4 border-slate-200' : 'border-slate-300'
      } bg-white`}
    >
      {/* ========== Header Row (Always Visible) ========== */}
      <button
        onClick={() => toggleSubagent(process.id)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        {/* Chevron */}
        <ChevronRight
          className={`w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />

        {/* Type badge */}
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colorClasses}`}
        >
          <Icon className="w-3 h-3" />
          {agentType}
        </span>

        {/* Model name */}
        {modelInfo && (
          <span
            className={`text-[11px] font-medium ${MODEL_TEXT_COLORS[modelInfo.family] ?? 'text-slate-500'}`}
          >
            {modelInfo.name}
          </span>
        )}

        {/* Description */}
        <span className="text-xs text-slate-500 truncate flex-1 text-left">
          {truncatedDesc}
        </span>

        {/* Status indicator */}
        {process.isOngoing ? (
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        )}

        {/* MetricsPill - mainSessionImpact preferred */}
        <MetricsPill mainTokens={headerTokens} />

        {/* Duration */}
        <span className="text-xs text-slate-400 font-mono tabular-nums flex items-center gap-0.5 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {formatDuration(process.durationMs)}
        </span>
      </button>

      {/* ========== Expanded Content ========== */}
      {expanded && (
        <div className="border-t border-slate-200 px-4 py-3 space-y-3">
          {/* Row 1: Key metadata (horizontal flow with dot separators) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>
              <span className="text-slate-400">Type</span>{' '}
              <span className="font-mono text-slate-600">{agentType}</span>
            </span>
            <span className="text-slate-300">&bull;</span>
            <span>
              <span className="text-slate-400">Duration</span>{' '}
              <span className="font-mono tabular-nums text-slate-600">
                {formatDuration(process.durationMs)}
              </span>
            </span>
            {modelInfo && (
              <>
                <span className="text-slate-300">&bull;</span>
                <span>
                  <span className="text-slate-400">Model</span>{' '}
                  <span
                    className={`font-mono ${MODEL_TEXT_COLORS[modelInfo.family] ?? 'text-slate-600'}`}
                  >
                    {modelInfo.name}
                  </span>
                </span>
              </>
            )}
            <span className="text-slate-300">&bull;</span>
            <span>
              <span className="text-slate-400">ID</span>{' '}
              <span
                className="font-mono text-slate-400 inline-block max-w-[120px] truncate align-bottom"
                title={process.id}
              >
                {process.id.slice(0, 8)}
              </span>
            </span>
          </div>

          {/* Row 2: Token context */}
          {(hasMainImpact || hasIsolated) && (
            <div className="space-y-1.5">
              {hasMainImpact && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="w-3 h-3 text-amber-400" />
                    <span className="text-slate-500">Main Context</span>
                  </div>
                  <span className="font-mono tabular-nums text-slate-600">
                    {process.mainSessionImpact!.totalTokens.toLocaleString()} tokens
                  </span>
                </div>
              )}
              {hasIsolated && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CircleDot className="w-3 h-3 text-sky-400" />
                    <span className="text-slate-500">Subagent Context</span>
                  </div>
                  <span className="font-mono tabular-nums text-slate-600">
                    {isolatedTotal.toLocaleString()} tokens
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Row 3: Execution Trace (nested collapsible) */}
          {displayItems.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
              {/* Trace header */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSubagentTrace(process.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-100 transition-colors"
              >
                <ChevronRight
                  className={`w-3 h-3 text-slate-400 transition-transform ${
                    showTrace ? 'rotate-90' : ''
                  }`}
                />
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-600">Execution Trace</span>
                <span className="text-[11px] text-slate-400">
                  &middot; {itemsSummary}
                </span>
              </button>

              {/* Trace content */}
              {showTrace && (
                <div className="border-t border-slate-200 p-2 space-y-1">
                  {displayItems.map((item, index) => (
                    <ExecutionTraceItem
                      key={getItemKey(item, index)}
                      item={item}
                      index={index}
                      expandedItemId={expandedTraceItemId}
                      onItemClick={handleTraceItemClick}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {displayItems.length === 0 && process.messages.length === 0 && (
            <div className="text-xs text-slate-400 italic">
              No messages in execution trace.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Execution Trace Item Renderer ───────────────────────────────────────────

interface ExecutionTraceItemProps {
  item: AIGroupDisplayItem;
  index: number;
  expandedItemId: string | null;
  onItemClick: (itemId: string) => void;
}

function getItemKey(item: AIGroupDisplayItem, index: number): string {
  switch (item.type) {
    case 'tool':
      return `trace-tool-${item.tool.id}`;
    case 'subagent':
      return `trace-subagent-${item.subagent.id}`;
    default:
      return `trace-${item.type}-${index}`;
  }
}

function ExecutionTraceItem({ item, index, expandedItemId, onItemClick }: ExecutionTraceItemProps) {
  switch (item.type) {
    case 'thinking': {
      const itemId = `trace-thinking-${index}`;
      const isExpanded = expandedItemId === itemId;
      const preview =
        item.content.length > 150 ? item.content.slice(0, 150) + '...' : item.content;
      return (
        <div className="border border-purple-200 bg-purple-50/50 rounded-lg overflow-hidden">
          <button
            onClick={() => onItemClick(itemId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-100/50 transition-colors"
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
            <Brain className="w-3.5 h-3.5" />
            <span className="font-medium">Thinking</span>
            <span className="text-purple-500 truncate flex-1 text-left">{preview}</span>
            {item.tokenCount != null && (
              <span className="text-[10px] text-purple-400 bg-purple-100 rounded-full px-1.5 py-0.5 flex-shrink-0">
                {formatTokenCount(item.tokenCount)}
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="px-3 py-2 border-t border-purple-200 bg-white/50">
              <pre className="text-xs text-purple-900 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {item.content}
              </pre>
            </div>
          )}
        </div>
      );
    }

    case 'tool': {
      const itemId = `trace-tool-${item.tool.id}`;
      const isExpanded = expandedItemId === itemId;
      const toolName = item.tool.name;
      const summary = generateToolSummary(toolName, item.tool.input);
      const isError = item.tool.result?.isError ?? false;
      const resultPreview = item.tool.outputPreview
        ? item.tool.outputPreview.length > 100
          ? item.tool.outputPreview.slice(0, 100) + '...'
          : item.tool.outputPreview
        : undefined;

      return (
        <div
          className={`border rounded-lg overflow-hidden ${
            isError
              ? 'border-red-300 bg-red-50/30'
              : item.tool.isOrphaned
                ? 'border-amber-300 bg-amber-50/30'
                : 'border-slate-200 bg-white'
          }`}
        >
          <button
            onClick={() => onItemClick(itemId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors"
          >
            <ChevronRight
              className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
            <span
              className={`font-medium ${isError ? 'text-red-600' : 'text-slate-700'}`}
            >
              {toolName}
            </span>
            <span className="text-slate-500 truncate flex-1 text-left">{summary}</span>
            {resultPreview && (
              <>
                <span className="text-slate-300 flex-shrink-0">&rarr;</span>
                <span className="text-slate-400 truncate max-w-[150px]">
                  {resultPreview}
                </span>
              </>
            )}
            {item.tool.durationMs != null && (
              <span className="text-[10px] text-slate-400 flex-shrink-0">
                {formatDuration(item.tool.durationMs)}
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="px-3 py-2 border-t border-slate-200 space-y-2">
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Input
                </div>
                <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap bg-slate-50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(item.tool.input, null, 2)}
                </pre>
              </div>
              {item.tool.result && (
                <div>
                  <div
                    className={`text-[10px] uppercase font-semibold mb-1 ${
                      isError ? 'text-red-400' : 'text-slate-400'
                    }`}
                  >
                    {isError ? 'Error' : 'Result'}
                  </div>
                  <pre
                    className={`text-xs font-mono whitespace-pre-wrap rounded p-2 overflow-x-auto max-h-48 overflow-y-auto ${
                      isError
                        ? 'text-red-700 bg-red-50'
                        : 'text-slate-700 bg-slate-50'
                    }`}
                  >
                    {typeof item.tool.result.content === 'string'
                      ? item.tool.result.content
                      : JSON.stringify(item.tool.result.content, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    case 'output':
      return (
        <div className="px-3 py-1.5 text-xs">
          <TextItem content={item.content} />
        </div>
      );

    case 'subagent':
      return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
          <Bot className="w-3 h-3 flex-shrink-0" />
          <span className="font-medium">Subagent:</span>
          <span className="truncate">
            {item.subagent.description ?? item.subagent.id}
          </span>
        </div>
      );

    case 'subagent_input': {
      const itemId = `trace-input-${index}`;
      const isExpanded = expandedItemId === itemId;
      const preview =
        item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content;
      return (
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <button
            onClick={() => onItemClick(itemId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors"
          >
            <ChevronRight
              className={`w-3 h-3 text-slate-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
            <MailOpen className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium text-slate-600">Input</span>
            <span className="text-slate-500 truncate flex-1 text-left">{preview}</span>
            {item.tokenCount != null && (
              <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5 flex-shrink-0">
                {formatTokenCount(item.tokenCount)}
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="px-3 py-2 border-t border-slate-200">
              <TextItem content={item.content} />
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
