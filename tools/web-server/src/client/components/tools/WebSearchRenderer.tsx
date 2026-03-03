import { Search } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

interface SearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

function parseResults(content: string): SearchResult[] | null {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const results = parsed as unknown[];
      const typed = results.filter(
        (r): r is SearchResult =>
          typeof r === 'object' &&
          r !== null &&
          ('title' in r || 'url' in r || 'snippet' in r),
      );
      if (typed.length > 0) return typed;
    }
  } catch {
    // Not JSON — fall through
  }
  return null;
}

export function WebSearchRenderer({ execution }: Props) {
  const { input, result } = execution;
  const query = (input.query as string) ?? '';
  const isError = result?.isError ?? false;

  const content = extractResultContent(result);
  const structuredResults = content ? parseResults(content) : null;

  return (
    <div className="space-y-2 text-sm">
      {/* Header: icon + query */}
      <div className="flex items-center gap-2 text-slate-600">
        <Search className="w-4 h-4 shrink-0" />
        {query && (
          <span className="text-xs font-medium">
            &ldquo;{query}&rdquo;
          </span>
        )}
        {structuredResults && (
          <span className="text-xs text-slate-400">
            {structuredResults.length} result{structuredResults.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Structured results */}
      {structuredResults ? (
        <div className="space-y-2 pl-6">
          {structuredResults.map((r, i) => (
            <div key={i} className="border-l-2 border-slate-200 pl-3 space-y-0.5">
              {r.title && (
                <div className="text-xs font-semibold text-slate-800">{r.title}</div>
              )}
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline truncate block"
                  title={r.url}
                >
                  {r.url}
                </a>
              )}
              {r.snippet && (
                <div className="text-xs text-slate-600">{r.snippet}</div>
              )}
            </div>
          ))}
        </div>
      ) : content ? (
        /* Plain text fallback */
        <pre
          className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-48 overflow-y-auto ${
            isError
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-slate-50 text-slate-800'
          }`}
        >
          {content}
        </pre>
      ) : (
        <div className="text-xs text-slate-400 italic pl-6">No results returned.</div>
      )}
    </div>
  );
}
