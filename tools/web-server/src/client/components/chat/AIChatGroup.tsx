import { useMemo } from 'react';
import { Bot, ChevronRight, Clock } from 'lucide-react';
import { enhanceAIGroup } from '../../utils/ai-group-enhancer.js';
import { DisplayItemList } from './DisplayItemList.js';
import { LastOutputDisplay } from './LastOutputDisplay.js';
import { ContextBadge } from './context/ContextBadge.js';
import { TokenUsageDisplay } from './TokenUsageDisplay.js';
import { useSessionViewStore } from '../../store/session-store.js';
import { formatDuration, formatTimestampLong } from '../../utils/session-formatters.js';
import type { AIGroup, SlashItem } from '../../types/groups.js';
import type { ContextStats } from '../../types/session.js';

interface Props {
  aiGroup: AIGroup;
  contextStats?: ContextStats;
  precedingSlash?: SlashItem;
  claudeMdStats?: { paths: string[]; totalTokens: number };
}

const MODEL_COLORS: Record<string, string> = {
  opus: 'text-orange-700 bg-orange-100',
  sonnet: 'text-blue-700 bg-blue-100',
  haiku: 'text-emerald-700 bg-emerald-100',
};

export function AIChatGroup({ aiGroup, contextStats, precedingSlash, claudeMdStats }: Props) {
  const expanded = useSessionViewStore((s) => s.expandedGroups.has(aiGroup.id));
  const toggleGroup = useSessionViewStore((s) => s.toggleGroup);

  const enhanced = useMemo(
    () => enhanceAIGroup(aiGroup, claudeMdStats, precedingSlash),
    [aiGroup, claudeMdStats, precedingSlash],
  );

  const modelColor = enhanced.mainModel
    ? MODEL_COLORS[enhanced.mainModel.family] ?? 'text-slate-700 bg-slate-100'
    : '';

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => toggleGroup(aiGroup.id)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-medium text-slate-600">Claude</span>
          {enhanced.mainModel && (
            <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${modelColor}`}>
              {enhanced.mainModel.name}
            </span>
          )}
          {enhanced.subagentModels.map((m) => (
            <span key={m.name} className="text-xs text-slate-400">&rarr; {m.name}</span>
          ))}
          <span className="text-slate-300">&middot;</span>
          <span className="text-xs text-slate-400 truncate">{enhanced.itemsSummary}</span>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {contextStats && (
            <ContextBadge
              totalNewTokens={contextStats.totalTokens}
              categories={categoryBreakdown(contextStats)}
            />
          )}
          <TokenUsageDisplay tokens={aiGroup.tokens} />
          {aiGroup.durationMs > 0 && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatDuration(aiGroup.durationMs)}
            </span>
          )}
          <span className="text-xs text-slate-400">{formatTimestampLong(aiGroup.startTime)}</span>
        </div>
      </button>
      {expanded && (
        <div className="pl-10 mt-1">
          <DisplayItemList items={enhanced.displayItems} />
        </div>
      )}
      <div className="pl-10">
        <LastOutputDisplay lastOutput={enhanced.lastOutput} />
      </div>
    </div>
  );
}

function categoryBreakdown(stats: ContextStats) {
  const cats = stats.turnTokens;
  return [
    { label: 'CLAUDE.md', tokens: cats.claudeMd },
    { label: 'Mentioned Files', tokens: cats.mentionedFiles },
    { label: 'Tool Outputs', tokens: cats.toolOutputs },
    { label: 'Thinking/Text', tokens: cats.thinkingText },
    { label: 'Task Coordination', tokens: cats.taskCoordination },
    { label: 'User Messages', tokens: cats.userMessages },
  ].filter((c) => c.tokens > 0);
}
