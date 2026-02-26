import { useState, useRef } from 'react';
import { Database } from 'lucide-react';
import { formatTokensCompact } from '../../../utils/session-formatters.js';

interface ContextCategory {
  label: string;
  tokens: number;
}

interface Props {
  totalNewTokens: number;
  categories?: ContextCategory[];
}

export function ContextBadge({ totalNewTokens, categories = [] }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);

  if (totalNewTokens === 0) return null;

  return (
    <div className="relative inline-block" ref={badgeRef}>
      <button
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className="flex items-center gap-1 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 hover:bg-violet-100 transition-colors"
      >
        <Database className="w-3 h-3" />
        <span className="font-mono">{formatTokensCompact(totalNewTokens)}</span>
      </button>
      {showPopover && categories.length > 0 && (
        <div className="absolute z-50 bottom-full right-0 mb-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Context Breakdown</div>
          <div className="space-y-1 text-xs">
            {categories.map((cat) => (
              <div key={cat.label} className="flex justify-between text-slate-600">
                <span>{cat.label}</span>
                <span className="font-mono">{formatTokensCompact(cat.tokens)}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-1 mt-1">
              <div className="flex justify-between font-medium text-slate-800">
                <span>Total</span>
                <span className="font-mono">{formatTokensCompact(totalNewTokens)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
