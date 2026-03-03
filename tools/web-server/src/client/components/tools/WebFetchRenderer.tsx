import { Globe } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

function truncateUrl(url: string, maxLength = 80): string {
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength) + '\u2026';
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function WebFetchRenderer({ execution }: Props) {
  const { input, result } = execution;
  const url = (input.url as string) ?? '';
  const prompt = (input.prompt as string) ?? '';

  const content = extractResultContent(result);
  const isError = result?.isError ?? false;

  return (
    <div className="space-y-2 text-sm">
      {/* URL header */}
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 shrink-0 text-slate-400" />
        {isValidUrl(url) ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline truncate"
            title={url}
          >
            {truncateUrl(url)}
          </a>
        ) : (
          <span className="text-xs font-mono text-slate-700 truncate" title={url}>
            {truncateUrl(url)}
          </span>
        )}
      </div>

      {/* Prompt */}
      {prompt && (
        <div className="text-xs text-slate-500 italic pl-6 truncate" title={prompt}>
          {prompt}
        </div>
      )}

      {/* Result content */}
      {content ? (
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
        <div className="text-xs text-slate-400 italic pl-6">No content returned.</div>
      )}
    </div>
  );
}
