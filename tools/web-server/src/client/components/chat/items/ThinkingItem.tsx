import { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { formatTokenCount } from '../../../utils/session-formatters.js';

interface Props {
  content: string;
  tokenCount?: number;
}

export function ThinkingItem({ content, tokenCount }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-purple-200 bg-purple-50/50 rounded-lg overflow-hidden my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-100/50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <Brain className="w-4 h-4" />
        <span className="font-medium">Thinking</span>
        {tokenCount != null && (
          <span className="ml-auto text-xs text-purple-500 bg-purple-100 rounded-full px-2 py-0.5">
            {formatTokenCount(tokenCount)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-purple-200 bg-white/50">
          <pre className="text-xs text-purple-900 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
