import { useState } from 'react';
import { Minimize2, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { CompactChunk as CompactChunkType } from '../../types/session.js';

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
  chunk: CompactChunkType;
}

export function CompactChunk({ chunk }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasSummary = !!chunk.summary;

  return (
    <div className="my-6 px-4">
      {/* Divider row */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-amber-300" />
        <button
          type="button"
          onClick={() => hasSummary && setExpanded(!expanded)}
          className={`flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 ${
            hasSummary ? 'cursor-pointer hover:bg-amber-100 transition-colors' : 'cursor-default'
          }`}
        >
          <Minimize2 className="w-3 h-3" />
          <span className="font-medium">Context compacted</span>
          <span className="text-amber-500">{formatTimestamp(chunk.timestamp)}</span>
          {hasSummary && (
            <ChevronRight
              className={`w-3 h-3 text-amber-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </button>
        <div className="flex-1 h-px bg-amber-300" />
      </div>

      {/* Expanded summary */}
      {expanded && hasSummary && (
        <div className="mt-3 mx-8 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 max-h-64 overflow-y-auto">
          <div className="prose prose-sm prose-amber max-w-none text-amber-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {chunk.summary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
