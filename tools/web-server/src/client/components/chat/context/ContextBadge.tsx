import { useState, useRef } from 'react';
import { Layers } from 'lucide-react';
import { formatTokenCount } from '../../../utils/session-formatters.js';

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
        className="inline-flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 hover:bg-indigo-100 transition-colors"
      >
        <Layers className="w-3 h-3" />
        Context +{formatTokenCount(totalNewTokens)}
      </button>
      {showPopover && categories.length > 0 && (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Context Breakdown</div>
          <div className="space-y-1.5">
            {categories.map((cat) => (
              <div key={cat.label} className="flex justify-between text-xs">
                <span className="text-slate-600">{cat.label}</span>
                <span className="font-mono text-slate-800">{formatTokenCount(cat.tokens)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs font-medium">
            <span className="text-slate-700">Total</span>
            <span className="font-mono text-slate-900">{formatTokenCount(totalNewTokens)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
