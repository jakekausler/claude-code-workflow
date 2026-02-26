import { useState, useRef } from 'react';
import { formatTokensCompact } from '../../utils/session-formatters.js';
import type { AIGroupTokens } from '../../types/groups.js';

interface Props {
  tokens: AIGroupTokens;
  phaseNumber?: number;
  totalPhases?: number;
}

export function TokenUsageDisplay({ tokens, phaseNumber, totalPhases }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (tokens.total === 0) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className="text-xs text-slate-500 font-mono hover:text-slate-700 transition-colors"
      >
        {formatTokensCompact(tokens.total)}
      </button>
      {showPopover && (
        <div className="absolute z-50 bottom-full right-0 mb-1 w-52 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Token Usage</div>
          <div className="space-y-1 text-xs">
            <Row label="Input" value={tokens.input} />
            {tokens.cacheRead > 0 && <Row label="Cache Read" value={tokens.cacheRead} />}
            {tokens.cacheCreation > 0 && <Row label="Cache Write" value={tokens.cacheCreation} />}
            <Row label="Output" value={tokens.output} />
            <div className="border-t border-slate-100 pt-1 mt-1">
              <Row label="Total" value={tokens.total} bold />
            </div>
          </div>
          {phaseNumber != null && totalPhases != null && (
            <div className="mt-2 text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-0.5 text-center">
              Phase {phaseNumber} of {totalPhases}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTokensCompact(value)}</span>
    </div>
  );
}
