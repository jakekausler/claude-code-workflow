import { useState } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { formatTokensCompact, formatTimestampLong } from '../../utils/session-formatters.js';
import type { CompactGroup } from '../../types/groups.js';

const markdownComponents: Components = {
  ol({ children }) {
    return (
      <ol className="my-2 list-decimal space-y-1 pl-5">
        {children}
      </ol>
    );
  },
  ul({ children }) {
    return (
      <ul className="my-2 list-disc space-y-1 pl-5">
        {children}
      </ul>
    );
  },
  li({ children }) {
    return <li className="text-sm">{children}</li>;
  },
};

interface Props {
  compactGroup: CompactGroup;
}

export function CompactBoundary({ compactGroup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { summary, tokenDelta, startingPhaseNumber, timestamp } = compactGroup;
  const hasSummary = !!summary;

  return (
    <div className="my-6 px-4">
      {/* Divider row with centered badge */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-amber-300" />
        <button
          type="button"
          onClick={() => hasSummary && setExpanded(!expanded)}
          className={`flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 ${
            hasSummary ? 'cursor-pointer hover:bg-amber-100 transition-colors' : 'cursor-default'
          }`}
        >
          {hasSummary && (
            <ChevronRight
              className={`w-3 h-3 text-amber-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
          <Layers className="w-3 h-3" />
          <span className="font-medium">Compacted</span>
          {tokenDelta && (
            <span className="text-amber-600">
              {formatTokensCompact(tokenDelta.preCompactionTokens)}
              {' \u2192 '}
              {formatTokensCompact(tokenDelta.postCompactionTokens)}
              <span className="text-green-600 ml-1">
                ({formatTokensCompact(Math.abs(tokenDelta.delta))} freed)
              </span>
            </span>
          )}
          {startingPhaseNumber != null && (
            <span className="text-indigo-600 bg-indigo-100 rounded-full px-2 py-0.5 text-xs font-medium">
              Phase {startingPhaseNumber}
            </span>
          )}
          <span className="text-amber-500">{formatTimestampLong(timestamp)}</span>
        </button>
        <div className="flex-1 h-px bg-amber-300" />
      </div>

      {/* Expanded summary */}
      {expanded && hasSummary && (
        <div className="mt-3 mx-8 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 max-h-64 overflow-y-auto">
          <div className="prose prose-sm prose-amber max-w-none text-amber-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {summary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
