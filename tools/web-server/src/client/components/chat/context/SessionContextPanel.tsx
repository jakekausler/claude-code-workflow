import {
  Clock,
  DollarSign,
  MessageSquare,
  Wrench,
  Layers,
  Cpu,
  TrendingUp,
} from 'lucide-react';
import { formatTokenCount, formatDuration, formatCost } from '../../../utils/session-formatters.js';
import type { SessionMetrics, Chunk } from '../../../types/session.js';

interface Props {
  metrics: SessionMetrics;
  chunks: Chunk[];
  model?: string;
}

export function SessionContextPanel({ metrics, chunks, model }: Props) {
  const compactionCount = chunks.filter((c) => c.type === 'compact').length;

  return (
    <div className="h-full overflow-y-auto bg-white border-l border-slate-200 p-4 space-y-6">
      {/* Session Summary */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Session Summary</h3>
        <div className="space-y-2">
          {model && <SummaryRow icon={Cpu} label="Model" value={model} />}
          <SummaryRow icon={MessageSquare} label="Turns" value={String(metrics.turnCount)} />
          <SummaryRow icon={Wrench} label="Tool Calls" value={String(metrics.toolCallCount)} />
          <SummaryRow icon={Clock} label="Duration" value={formatDuration(metrics.duration)} />
          <SummaryRow icon={DollarSign} label="Cost" value={formatCost(metrics.totalCost)} />
        </div>
      </div>

      {/* Token Breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Token Usage</h3>
        <div className="space-y-2">
          <TokenRow label="Total" tokens={metrics.totalTokens} isTotal />
          <TokenRow label="Input" tokens={metrics.inputTokens} />
          <TokenRow label="Output" tokens={metrics.outputTokens} />
          {metrics.cacheReadTokens > 0 && (
            <TokenRow label="Cache Read" tokens={metrics.cacheReadTokens} />
          )}
          {metrics.cacheCreationTokens > 0 && (
            <TokenRow label="Cache Write" tokens={metrics.cacheCreationTokens} />
          )}
        </div>
      </div>

      {/* Compaction Timeline */}
      {compactionCount > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            <Layers className="w-4 h-4 inline mr-1" />
            Compactions
          </h3>
          <div className="text-xs text-slate-600">
            {compactionCount} context compaction{compactionCount > 1 ? 's' : ''} occurred during this session.
          </div>
          <div className="mt-2 flex items-center gap-1">
            {chunks.map((chunk, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-sm ${
                  chunk.type === 'compact' ? 'bg-amber-400' : 'bg-slate-200'
                }`}
                title={chunk.type === 'compact' ? `Compaction at position ${i}` : undefined}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Start</span>
            <span>End</span>
          </div>
        </div>
      )}

      {/* Session Progress */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          <TrendingUp className="w-4 h-4 inline mr-1" />
          Activity
        </h3>
        <div className="text-xs text-slate-600 space-y-1">
          <div>{chunks.filter((c) => c.type === 'user').length} user messages</div>
          <div>{chunks.filter((c) => c.type === 'ai').length} AI responses</div>
          <div>{chunks.filter((c) => c.type === 'system').length} system events</div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 flex-1">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function TokenRow({
  label,
  tokens,
  isTotal = false,
}: {
  label: string;
  tokens: number;
  isTotal?: boolean;
}) {
  return (
    <div className={`flex justify-between text-xs ${isTotal ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTokenCount(tokens)}</span>
    </div>
  );
}
