import { useState, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatTokensCompact } from '../../utils/session-formatters.js';
import type { AIGroupTokens } from '../../types/groups.js';

interface ContextCategory {
  label: string;
  tokens: number;
}

const MODEL_TEXT_COLORS: Record<string, string> = {
  opus: 'text-orange-500',
  sonnet: 'text-blue-500',
  haiku: 'text-emerald-500',
};

interface Props {
  tokens: AIGroupTokens;
  phaseNumber?: number;
  totalPhases?: number;
  contextCategories?: ContextCategory[];
  modelName?: string;
  modelFamily?: string;
}

export function TokenUsageDisplay({
  tokens,
  phaseNumber,
  totalPhases,
  contextCategories,
  modelName,
  modelFamily,
}: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearHideTimeout();
    setShowPopover(true);
  };

  const handleMouseLeave = () => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  if (tokens.total === 0) return null;

  const hasContext = contextCategories && contextCategories.length > 0;
  const totalContextTokens = hasContext
    ? contextCategories.reduce((sum, c) => sum + c.tokens, 0)
    : 0;

  const modelTextColor = modelFamily
    ? MODEL_TEXT_COLORS[modelFamily] ?? 'text-slate-400'
    : 'text-slate-400';

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setShowPopover(true)}
        onBlur={() => setShowPopover(false)}
        className="text-xs text-slate-500 font-mono hover:text-slate-700 transition-colors"
      >
        {formatTokensCompact(tokens.total)}
      </button>
      {showPopover && (
        <div
          className="absolute z-50 bottom-full right-0 mb-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 p-3"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-xs font-medium text-slate-700 mb-2">Token Usage</div>
          <div className="space-y-1 text-xs">
            <Row label="Input Tokens" value={tokens.input} />
            {tokens.cacheRead > 0 && <Row label="Cache Read" value={tokens.cacheRead} />}
            {tokens.cacheCreation > 0 && <Row label="Cache Write" value={tokens.cacheCreation} />}
            <Row label="Output Tokens" value={tokens.output} />
            <div className="border-t border-slate-100 pt-1 mt-1">
              <Row label="Total" value={tokens.total} bold />
            </div>
          </div>
          {hasContext && (
            <>
              <div className="border-t border-slate-200 my-2" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextExpanded((prev) => !prev);
                }}
                className="flex items-center gap-1 text-xs font-medium text-slate-700 w-full hover:text-slate-900 transition-colors"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${contextExpanded ? 'rotate-90' : ''}`}
                />
                <span>Visible Context</span>
              </button>
              {contextExpanded && (
                <div className="mt-1.5 space-y-1 text-xs">
                  {contextCategories.map((cat) => {
                    const pct =
                      totalContextTokens > 0
                        ? ((cat.tokens / totalContextTokens) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <div key={cat.label} className="flex justify-between text-slate-600">
                        <span>{cat.label}</span>
                        <span className="font-mono">
                          {cat.tokens.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {modelName && (
            <>
              <div className="border-t border-slate-200 my-2" />
              <div className={`text-xs font-medium ${modelTextColor}`}>{modelName}</div>
            </>
          )}
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
      <span className="font-mono">{value.toLocaleString()}</span>
    </div>
  );
}
