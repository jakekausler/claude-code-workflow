import { useState } from 'react';
import {
  Clock,
  DollarSign,
  MessageSquare,
  Wrench,
  Cpu,
  ChevronRight,
} from 'lucide-react';
import { formatTokenCount, formatDuration, formatCost } from '../../../utils/session-formatters.js';
import type { SessionMetrics, Chunk } from '../../../types/session.js';

interface Props {
  metrics: SessionMetrics;
  chunks: Chunk[];
  model?: string;
}

export function ContextAccordion({ metrics, chunks, model }: Props) {
  const compactionCount = chunks.filter((c) => c.type === 'compact').length;

  return (
    <div className="border-b border-slate-200 mb-2">
      <AccordionItem title="Session Summary" defaultOpen={false}>
        <div className="space-y-2">
          {model && <SummaryRow icon={Cpu} label="Model" value={model} />}
          <SummaryRow icon={MessageSquare} label="Turns" value={String(metrics.turnCount)} />
          <SummaryRow icon={Wrench} label="Tool Calls" value={String(metrics.toolCallCount)} />
          <SummaryRow icon={Clock} label="Duration" value={formatDuration(metrics.duration)} />
          <SummaryRow icon={DollarSign} label="Cost" value={formatCost(metrics.totalCost)} />
        </div>
      </AccordionItem>

      <AccordionItem title="Token Usage" defaultOpen={false}>
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
      </AccordionItem>

      {compactionCount > 0 && (
        <AccordionItem title={`Compactions (${compactionCount})`} defaultOpen={false}>
          <div className="text-xs text-slate-600">
            {compactionCount} context compaction{compactionCount > 1 ? 's' : ''} occurred during this session.
          </div>
          <div className="mt-2 flex items-center gap-1">
            {chunks.map((chunk, i) => (
              <div
                key={i}
                className={[
                  'h-2 flex-1 rounded-sm',
                  chunk.type === 'compact' ? 'bg-amber-400' : 'bg-slate-200',
                ].join(' ')}
                title={chunk.type === 'compact' ? `Compaction at position ${i}` : undefined}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Start</span>
            <span>End</span>
          </div>
        </AccordionItem>
      )}

      <AccordionItem title="Activity" defaultOpen={false}>
        <div className="text-xs text-slate-600 space-y-1">
          <div>{chunks.filter((c) => c.type === 'user').length} user messages</div>
          <div>{chunks.filter((c) => c.type === 'ai').length} AI responses</div>
          <div>{chunks.filter((c) => c.type === 'system').length} system events</div>
        </div>
      </AccordionItem>
    </div>
  );
}

function AccordionItem({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
      >
        {title}
        <ChevronRight
          size={14}
          className={[
            'text-slate-400 transition-transform',
            isOpen ? 'rotate-90' : '',
          ].join(' ')}
        />
      </button>
      {isOpen && <div className="pb-3">{children}</div>}
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
    <div className={[
      'flex justify-between text-xs',
      isTotal ? 'font-medium text-slate-800' : 'text-slate-600',
    ].join(' ')}>
      <span>{label}</span>
      <span className="font-mono">{formatTokenCount(tokens)}</span>
    </div>
  );
}
